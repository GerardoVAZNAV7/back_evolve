import { config } from './config.js';

interface Email {
  to: string;
  subject: string;
  text: string;
}

// Sin RESEND_API_KEY se loguea el contenido: alcanza para desarrollo local.
export async function sendEmail({ to, subject, text }: Email): Promise<void> {
  if (!config.resendApiKey) {
    console.warn(`[mail] Sin RESEND_API_KEY. Para ${to}: ${subject}\n${text}`);
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.resendApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from: config.mailFrom, to, subject, text }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Resend respondió ${response.status}: ${await response.text()}`);
  }
}

export function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  return sendEmail({
    to,
    subject: 'Recuperá tu contraseña de Evolve',
    text: [
      'Abrí este enlace para elegir una nueva contraseña (vence en 30 minutos):',
      resetUrl,
      '',
      'Si no lo pediste, ignorá este mensaje: tu contraseña sigue igual.',
    ].join('\n'),
  });
}
