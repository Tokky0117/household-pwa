/* Shared JSON contract is owned by the PWA root, never duplicated. */
import '../receipt-chatgpt-import.js';
const api=globalThis.KurashiReceiptImport;
export const IMPORT_VERSION=api.IMPORT_VERSION;
export const parseChatGptReceiptJson=api.parseChatGptReceiptJson;
export const editChatGptReceiptDraft=api.editChatGptReceiptDraft;
export const draftQuality=api.draftQuality;
export const makeChatGptReceiptPrompt=api.makeChatGptReceiptPrompt;
