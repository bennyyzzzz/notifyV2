/** `abcd…wxyz` — used for FCM tokens and keys in debug screens and logs (7.10, 7.12). */
export function maskToken(token: string, visible = 4): string {
  if (token.length <= visible * 2 + 1) return '•'.repeat(Math.min(token.length, 8));
  return `${token.slice(0, visible)}…${token.slice(-visible)}`;
}

/** `jo•••@exemplo.com.br` */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const shown = local.slice(0, Math.min(2, Math.max(1, local.length - 1)));
  return `${shown}•••@${domain}`;
}

/** E-mails are stored normalized; the database also enforces `email = lower(email)`. */
export function normalizeEmail(email: string): string {
  return email.normalize('NFC').trim().toLowerCase();
}
