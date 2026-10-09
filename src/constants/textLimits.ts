/**
 * Limites de comprimento dos campos de texto do app.
 *
 * Cada constante espelha um limite que JÁ é imposto no servidor — o cliente
 * apenas impede que o usuário digite algo que seria recusado depois. O valor
 * autoritativo está sempre do outro lado; se mudar lá, mude aqui (é a mesma
 * duplicação intencional descrita no §9 do CLAUDE.md, já que `functions/src/`
 * não pode importar de fora do próprio rootDir).
 *
 * Limites de criação de evento (título, local, descrição, link) ficam locais em
 * `CreateEventModal.tsx`: têm um único consumidor e não se beneficiam de subir.
 */

/**
 * Mensagem de chat. Espelha `sendChatMessage` em `functions/src/index.ts`, que
 * rejeita `text.length > 2000` com invalid-argument. Sem este limite o campo
 * aceitava texto infinito e o erro só aparecia depois de tocar em enviar.
 */
export const CHAT_MESSAGE_MAX_LENGTH = 2000;

/** Mensagens do chat temporário do evento têm limite menor nas firestore.rules. */
export const EVENT_CHAT_MESSAGE_MAX_LENGTH = 500;

/**
 * Nick. Espelha o `NICK_PATTERN` de `src/services/profileService.ts`
 * (`/^[a-z0-9._-]{3,20}$/`), que é validado antes de reservar o documento em
 * `nicknames/{searchName}`.
 */
export const NICK_MAX_LENGTH = 20;

/**
 * Biografia do perfil. As `firestore.rules` aceitam até 1000 caracteres; 300 é
 * a escolha de produto, bem mais curta, para manter os perfis legíveis.
 */
export const BIO_MAX_LENGTH = 300;

/** Comprimento máximo de um endereço de e-mail pela RFC 5321. */
export const EMAIL_MAX_LENGTH = 254;

/**
 * Senha. Folgado de propósito: o objetivo aqui é só barrar colagem abusiva, não
 * validar força. Um teto apertado num campo de LOGIN recusaria silenciosamente
 * quem já tem senha longa criada antes deste limite, e o sintoma pareceria
 * "senha incorreta" — falha cara de diagnosticar. 256 fica acima de qualquer
 * gerador de senhas real e elimina esse risco.
 */
export const PASSWORD_MAX_LENGTH = 256;
