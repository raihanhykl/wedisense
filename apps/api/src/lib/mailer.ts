import fs from 'fs';
import path from 'path';
import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;
const templateCache = new Map<string, string>();

function getTransporter(): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env['SMTP_HOST'] ?? 'localhost',
    port: Number(process.env['SMTP_PORT'] ?? 587),
    auth: {
      user: process.env['SMTP_USER'] ?? '',
      pass: process.env['SMTP_PASS'] ?? '',
    },
  });

  return transporter;
}

// __dirname under tsx points at apps/api/src/lib; after build it sits at
// apps/api/dist/lib. In both cases ../templates/emails resolves to a
// templates folder co-located with the source/build root, so the lookup
// is independent of where the process was started from.
const TEMPLATES_ROOT = path.resolve(__dirname, '..', 'templates', 'emails');

function resolveTemplatePath(templateName: string, lang: string): string {
  return path.join(TEMPLATES_ROOT, `${templateName}.${lang}.html`);
}

function loadTemplate(templateName: string, lang: string): string {
  const cacheKey = `${templateName}.${lang}`;
  const cached = templateCache.get(cacheKey);
  if (cached) return cached;

  const filePath = resolveTemplatePath(templateName, lang);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    templateCache.set(cacheKey, content);
    return content;
  } catch {
    // Try fallback to 'id'
    if (lang !== 'id') {
      return loadTemplate(templateName, 'id');
    }
    return '';
  }
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [key, value]) => {
    return acc.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
  }, template);
}

export interface SendNotificationEmailOptions {
  to: string;
  templateName: string;
  lang: string;
  vars: Record<string, string | number>;
  subject: string;
}

/**
 * Send a notification email using an HTML template.
 * Never throws upstream — all errors are swallowed.
 */
export async function sendNotificationEmail(opts: SendNotificationEmailOptions): Promise<void> {
  if (process.env['NOTIFICATION_EMAIL_ENABLED'] !== 'true') {
    return;
  }

  const smtpHost = process.env['SMTP_HOST'];
  const smtpUser = process.env['SMTP_USER'];
  if (!smtpHost || !smtpUser) {
    return;
  }

  try {
    const rawTemplate = loadTemplate(opts.templateName, opts.lang);
    if (!rawTemplate) return;

    const html = interpolate(rawTemplate, opts.vars);
    const from = `${process.env['SMTP_FROM_NAME'] ?? 'Wedisense'} <${process.env['SMTP_FROM'] ?? 'noreply@wedisense.com'}>`;

    await getTransporter().sendMail({
      from,
      to: opts.to,
      subject: interpolate(opts.subject, opts.vars),
      html,
    });
  } catch (err) {
    console.error('[Mailer] Failed to send email:', err instanceof Error ? err.message : err);
  }
}
