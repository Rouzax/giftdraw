import nodemailer from 'nodemailer';

export function createMailer(config, createTransport = nodemailer.createTransport) {
  const { smtp } = config;
  if (!smtp) {
    return {
      enabled: false,
      async send() {
        throw new Error('mail is not configured');
      },
    };
  }
  // Port 465 speaks TLS from the first byte; anything else must upgrade with
  // STARTTLS, and requireTLS refuses to send in clear if the upgrade is missing.
  const implicitTls = smtp.port === 465;
  const transport = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: implicitTls,
    requireTLS: !implicitTls,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    pool: true,
    maxConnections: 2,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
  return {
    enabled: true,
    async send({ to, subject, html, text }) {
      await transport.sendMail({ from: smtp.from, to, subject, html, text });
    },
  };
}
