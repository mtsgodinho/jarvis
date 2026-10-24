import { validateLocalAction } from '../contracts/local-actions.mjs';

export const MAX_CONVERSATION_MESSAGES = 20;
export const MAX_AI_HISTORY_MESSAGES = 12;
export const MAX_AI_HISTORY_CHARACTERS = 6000;
export const MAX_AI_MESSAGE_CHARACTERS = 1500;

export function selectConversationHistory(messages) {
  const history = [];
  let characters = 0;
  const recent = messages.slice(-MAX_AI_HISTORY_MESSAGES);
  for (let index = recent.length - 2; index >= 0; index -= 2) {
    const exchange = recent.slice(index, index + 2).map(({ role, text }) => ({
      role, text: text.length > MAX_AI_MESSAGE_CHARACTERS
        ? `${text.slice(0, MAX_AI_MESSAGE_CHARACTERS - 1)}…` : text,
    }));
    const size = exchange.reduce((total, message) => total + message.text.length, 0);
    if (characters + size > MAX_AI_HISTORY_CHARACTERS) break;
    history.unshift(...exchange);
    characters += size;
  }
  return history;
}

export function createConversationContext() {
  const sessions = new Map();
  return {
    getMessages(id) {
      return (sessions.get(id)?.messages || []).map(message => ({ ...message }));
    },
    getHistory(id) {
      return selectConversationHistory(this.getMessages(id));
    },
    getLastAction(id) {
      const action = sessions.get(id)?.lastAction;
      return action ? { action: action.action, params: { ...action.params } } : null;
    },
    appendExchange(id, message, answer, action) {
      const previous = sessions.get(id)?.messages || [];
      sessions.set(id, {
        messages: [...previous, { role: 'user', text: message }, { role: 'model', text: answer }]
          .slice(-MAX_CONVERSATION_MESSAGES),
        lastAction: action ? validateLocalAction(action.action, action.params) : null,
      });
    },
    delete(id) {
      sessions.delete(id);
    },
    clear() {
      sessions.clear();
    },
  };
}
