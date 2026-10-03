import net from "node:net";
import tls from "node:tls";
import { getConfig } from "../../../config/src/index.js";
import * as alerts from "../alerts/repository.js";
import { postSafeWebhook } from "../ssl/networkSafety.js";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username?: string;
  password?: string;
  from: string;
}

class SmtpEmailProvider implements EmailProvider {
  constructor(private readonly config: SmtpConfig) {}

  async send(message: EmailMessage): Promise<void> {
    const socket = await this.connect();
    try {
      await this.expect(socket, 220);
      await this.command(socket, `EHLO ssl-monitor`, 250);

      if (!this.config.secure) {
        await this.command(socket, "STARTTLS", 220);
        const secureSocket = await this.upgradeTls(socket);
        await this.command(secureSocket, `EHLO ssl-monitor`, 250);
        await this.authenticateIfConfigured(secureSocket);
        await this.sendMessage(secureSocket, message);
        await this.command(secureSocket, "QUIT", 221).catch(() => undefined);
        secureSocket.end();
        return;
      }

      await this.authenticateIfConfigured(socket);
      await this.sendMessage(socket, message);
      await this.command(socket, "QUIT", 221).catch(() => undefined);
      socket.end();
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }

  private connect(): Promise<tls.TLSSocket | net.Socket> {
    if (this.config.secure) {
      return new Promise((resolve, reject) => {
        const socket = tls.connect({
          host: this.config.host,
          port: this.config.port,
          servername: this.config.host,
        });
        socket.once("secureConnect", () => resolve(socket));
        socket.once("error", reject);
      });
    }
    return new Promise((resolve, reject) => {
      const socket = net.connect({
        host: this.config.host,
        port: this.config.port,
      });
      socket.once("connect", () => resolve(socket));
      socket.once("error", reject);
    });
  }

  private upgradeTls(
    socket: net.Socket | tls.TLSSocket,
  ): Promise<tls.TLSSocket> {
    return new Promise((resolve, reject) => {
      const secure = tls.connect({ socket, servername: this.config.host });
      secure.once("secureConnect", () => resolve(secure));
      secure.once("error", reject);
    });
  }

  private async authenticateIfConfigured(
    socket: net.Socket | tls.TLSSocket,
  ): Promise<void> {
    if (!this.config.username && !this.config.password) return;
    if (!this.config.username || !this.config.password)
      throw new Error("SMTP credentials are incomplete");
    await this.command(socket, "AUTH LOGIN", 334);
    await this.command(
      socket,
      Buffer.from(this.config.username).toString("base64"),
      334,
    );
    await this.command(
      socket,
      Buffer.from(this.config.password).toString("base64"),
      235,
    );
  }

  private async sendMessage(
    socket: net.Socket | tls.TLSSocket,
    message: EmailMessage,
  ): Promise<void> {
    await this.command(socket, `MAIL FROM:<${this.config.from}>`, 250);
    await this.command(socket, `RCPT TO:<${message.to}>`, 250);
    await this.command(socket, "DATA", 354);
    const subject = message.subject.replace(/[\r\n]/g, " ");
    const body = message.text.replace(/^\./gm, "..");
    await this.command(
      socket,
      `From: ${this.config.from}\r\nTo: ${message.to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n.`,
      250,
    );
  }

  private expect(
    socket: net.Socket | tls.TLSSocket,
    code: number,
  ): Promise<void> {
    return this.readResponse(socket).then((response) => {
      if (response.code !== code)
        throw new Error(`SMTP server returned ${response.code}`);
    });
  }

  private command(
    socket: net.Socket | tls.TLSSocket,
    command: string,
    expected: number,
  ): Promise<void> {
    socket.write(`${command}\r\n`);
    return this.expect(socket, expected);
  }

  private readResponse(
    socket: net.Socket | tls.TLSSocket,
  ): Promise<{ code: number; text: string }> {
    return new Promise((resolve, reject) => {
      let buffer = "";
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\r\n");
        buffer = lines.pop() ?? "";
        const complete = lines.filter((line) => /^\d{3} /.test(line)).at(-1);
        if (!complete) return;
        cleanup();
        resolve({
          code: Number.parseInt(complete.slice(0, 3), 10),
          text: complete.slice(4),
        });
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        socket.off("data", onData);
        socket.off("error", onError);
      };
      socket.on("data", onData);
      socket.on("error", onError);
    });
  }
}

export function createConfiguredEmailProvider(): EmailProvider | null {
  const config = getConfig();
  if (!config.SMTP_HOST || !config.SMTP_FROM) return null;
  return new SmtpEmailProvider({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    username: config.SMTP_USER,
    password: config.SMTP_PASSWORD,
    from: config.SMTP_FROM,
  });
}

function notificationLog(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      component: "ssl-monitor-notifications",
      event,
      ...fields,
    }),
  );
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 240);
  return "Notification delivery failed";
}

export interface DispatchDependencies {
  emailProvider?: EmailProvider | null;
  webhookSender?: typeof postSafeWebhook;
}

export async function dispatchAlert(
  alert: alerts.AlertRow,
  settings: {
    emailEnabled: boolean;
    emailAddress: string | null;
    webhookEnabled: boolean;
    webhookUrl: string | null;
  },
  deps: DispatchDependencies = {},
): Promise<void> {
  const channels: Array<"webhook" | "email"> = [];
  if (settings.webhookEnabled && settings.webhookUrl) channels.push("webhook");
  if (settings.emailEnabled && settings.emailAddress) channels.push("email");

  for (const channel of channels) {
    let delivery: alerts.AlertDeliveryRow;
    try {
      delivery = await alerts.createDelivery(alert.id, alert.user_id, channel);
    } catch {
      continue;
    }
    const maxAttempts = getConfig().NOTIFICATION_RETRY_MAX_ATTEMPTS + 1;
    let attempt = delivery.attempt_count;
    let lastError: string | null = null;
    notificationLog("notification_attempt_started", {
      alertId: alert.id,
      channel,
    });
    let delivered = false;

    while (attempt < maxAttempts && !delivered) {
      attempt += 1;
      try {
        if (channel === "webhook") {
          await (deps.webhookSender ?? postSafeWebhook)(
            settings.webhookUrl!,
            {
              event: "ssl_alert",
              alert: {
                id: alert.id,
                domainId: alert.domain_id,
                type: alert.type,
                severity: alert.severity,
                state: alert.state,
                message: alert.message,
                createdAt: alert.created_at,
              },
            },
            getConfig().NOTIFICATION_TIMEOUT_MS,
          );
        } else {
          const provider =
            deps.emailProvider ?? createConfiguredEmailProvider();
          if (!provider) throw new Error("Email provider is not configured");
          await provider.send({
            to: settings.emailAddress!,
            subject: `[SSL Monitor] ${alert.severity}: ${alert.type}`,
            text: `${alert.message}\n\nDomain: ${alert.domain_id}\nAlert: ${alert.id}`,
          });
        }
        delivered = true;
        notificationLog("notification_delivered", {
          alertId: alert.id,
          channel,
          attempt,
        });
        await alerts.markDeliveryAttempt(
          delivery.id,
          "delivered",
          attempt,
          null,
          null,
          new Date(),
        );
      } catch (error) {
        lastError = safeErrorMessage(error);
        const exhausted = attempt >= maxAttempts;
        const nextAttemptAt = exhausted
          ? null
          : new Date(
              Date.now() +
                Math.min(
                  getConfig().NOTIFICATION_RETRY_DELAY_MS * 2 ** (attempt - 1),
                  getConfig().NOTIFICATION_MAX_RETRY_DELAY_MS,
                ),
            );
        await alerts.markDeliveryAttempt(
          delivery.id,
          exhausted ? "failed" : "pending",
          attempt,
          nextAttemptAt,
          lastError,
          null,
        );
        notificationLog(
          exhausted
            ? "notification_retry_exhausted"
            : "notification_retry_scheduled",
          { alertId: alert.id, channel, attempt },
        );
        if (!exhausted) {
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              Math.min(
                getConfig().NOTIFICATION_RETRY_DELAY_MS * 2 ** (attempt - 1),
                1000,
              ),
            ),
          );
        }
      }
    }
  }
}
