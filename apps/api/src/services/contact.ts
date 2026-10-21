import type { ContactMessageInput } from '@slider/shared';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';

/**
 * The website's contact form (bertro.dev/slider/kontakt): a plain-text mail to `CONTACT_EMAIL`,
 * with the sender as Reply-To – answering is just replying. Nothing is stored. A filled-in
 * honeypot (`website`) looks sent to the bot, but nothing goes out.
 */
export async function sendContactMessage(deps: AppDeps, input: ContactMessageInput) {
  const to = deps.config.contactEmail;
  if (!to || !deps.mailer.configured) {
    throw new ApiError(
      503,
      'contact_unavailable',
      'Das Kontaktformular ist gerade nicht verfügbar. Schreib uns bitte eine E-Mail.',
    );
  }
  if (input.website) return;
  const from = input.name ? `${input.name} <${input.email}>` : input.email;
  await deps.mailer.send({
    to,
    replyTo: input.email,
    subject: `Kontaktformular: ${input.name || input.email}`,
    text: `Von: ${from}\n\n${input.message}\n`,
  });
}
