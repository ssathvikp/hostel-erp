/**
 * Where reminders go (EP-11). Today every send is manual: the app opens
 * WhatsApp or copies the text, and the person presses send. An automated
 * provider (WhatsApp Business API, SMS, email) implements
 * `NotificationChannel` and logs to `reminder_log` with its own channel
 * name; nothing in the screens needs to change. No provider is configured
 * yet because each needs an account and, for WhatsApp, approved templates.
 */

export type ManualChannel = "whatsapp" | "copy";
export type ProviderChannel = "sms" | "email";
export type Channel = ManualChannel | ProviderChannel;

export interface OutgoingMessage {
  /** 10-digit Indian mobile number, or an email address for email. */
  to: string;
  body: string;
}

export interface SendResult {
  ok: boolean;
  /** The provider's id for the message, for delivery tracking. */
  providerMessageId?: string;
  error?: string;
}

/** An automated provider. None is implemented until an account exists. */
export interface NotificationChannel {
  readonly channel: ProviderChannel;
  send(message: OutgoingMessage): Promise<SendResult>;
}
