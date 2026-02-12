/**
 * Mailer for Brevo (brevo.com).
 * - Prefer BREVO_API_KEY (HTTPS API): works on Render free tier (no SMTP ports blocked).
 * - Fallback: SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS) for localhost.
 * Optional MAIL_FROM = "Name <email@domain.com>" (use a verified sender in Brevo).
 */
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const {
    BREVO_API_KEY,
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    SMTP_PASS,
    MAIL_FROM
} = process.env;

const useBrevoApi = Boolean(BREVO_API_KEY && BREVO_API_KEY.trim());
const useSmtp = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
const isConfigured = useBrevoApi || useSmtp;

const isBrevo = useBrevoApi || (SMTP_HOST && String(SMTP_HOST).toLowerCase().includes('brevo'));

let transporter = null;
if (useSmtp) {
    const port = parseInt(SMTP_PORT, 10) || 587;
    transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port,
        secure: SMTP_SECURE === 'true',
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        connectionTimeout: 15000,
        greetingTimeout: 10000
    });
}

/** Parse "Name <email>" or "email" into { name, email }. */
function parseSender(fromStr) {
    const raw = (fromStr || MAIL_FROM || SMTP_USER || '').trim();
    if (!raw) return { name: 'Gawri Ganga', email: 'noreply@gawriganga.com' };
    const match = raw.match(/^(.+?)\s*<([^>]+)>$/);
    if (match) return { name: match[1].trim(), email: match[2].trim() };
    return { name: 'Gawri Ganga', email: raw };
}

/** For Nodemailer: full "Name <email>" string. */
function getFromAddress() {
    const { name, email } = parseSender(MAIL_FROM || SMTP_USER);
    return `${name} <${email}>`;
}

const BREVO_EMAIL_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * Send email via Brevo HTTP API (works on Render free tier; uses HTTPS).
 */
async function sendViaBrevoApi(options) {
    const sender = parseSender(MAIL_FROM || SMTP_USER);
    const body = {
        sender: { name: sender.name, email: sender.email },
        to: [{ email: options.to }],
        subject: options.subject,
        htmlContent: options.html != null ? options.html : options.text,
        textContent: options.text || undefined
    };

    const res = await fetch(BREVO_EMAIL_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'api-key': BREVO_API_KEY.trim()
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errText = await res.text();
        let errMsg = errText;
        try {
            const j = JSON.parse(errText);
            errMsg = j.message || j.code || errText;
        } catch (_) {}
        throw new Error(errMsg || `Brevo API ${res.status}`);
    }

    const data = await res.json();
    return { messageId: data.messageId || data.messageIds?.[0] };
}

/**
 * Send an email. Uses Brevo API if BREVO_API_KEY is set (e.g. on Render), else SMTP.
 * @param {Object} options - { to, subject, text, html? }
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
export async function sendMail(options) {
    if (!isConfigured) {
        console.warn('[Mail] Not configured. Set BREVO_API_KEY (for Render) or SMTP_HOST/SMTP_USER/SMTP_PASS.');
        return { success: false, error: 'Mail not configured' };
    }

    const toMasked = options.to ? `${String(options.to).slice(0, 2)}***@${(String(options.to).split('@')[1] || '')}` : '?';

    try {
        if (useBrevoApi) {
            const result = await sendViaBrevoApi(options);
            console.log('[Mail] Sent via Brevo API', result.messageId, 'to', toMasked);
            return { success: true, messageId: result.messageId };
        }

        const mailOptions = {
            from: getFromAddress(),
            to: options.to,
            subject: options.subject,
            text: options.text,
            html: options.html != null ? options.html : options.text
        };
        const result = await transporter.sendMail(mailOptions);
        console.log('[Mail] Sent via SMTP', result.messageId, 'to', toMasked);
        return { success: true, messageId: result.messageId };
    } catch (err) {
        console.error('[Mail] Send failed:', err?.message || err);
        return { success: false, error: err?.message || String(err) };
    }
}

export { isConfigured, isBrevo };
