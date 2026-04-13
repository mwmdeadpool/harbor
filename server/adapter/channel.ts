/**
 * Harbor Channel — NanoClaw Channel implementation
 *
 * Registers Harbor as a first-class NanoClaw channel alongside Discord, Telegram, etc.
 * Routes messages between the Harbor 3D workspace and NanoClaw's message pipeline.
 *
 * JID format: harbor:<room>  (e.g. harbor:main)
 */

import type {
  Channel,
  NewMessage,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredGroup,
} from '../../../../src/types.js';
import type { ChannelOpts } from '../../../../src/channels/registry.js';
import { registerChannel } from '../../../../src/channels/registry.js';

import {
  initAdapter,
  disconnectAdapter,
  isAdapterConnected,
  sendToHarbor,
  updateAgentPresence,
  onHarborMessage,
} from './index.js';
import type { HarborInboundMessage } from './index.js';

const HARBOR_JID_PREFIX = 'harbor:';
const DEFAULT_HARBOR_PORT = 3333;

export class HarborChannel implements Channel {
  name = 'harbor';

  private opts: ChannelOpts;
  private serverUrl: string;
  private token: string;

  constructor(serverUrl: string, token: string, opts: ChannelOpts) {
    this.serverUrl = serverUrl;
    this.token = token;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    // Initialize the adapter WebSocket connection to Harbor server
    await initAdapter({
      serverUrl: this.serverUrl,
      token: this.token,
    });

    // Register the inbound message handler — converts Harbor chat → NanoClaw messages
    onHarborMessage((harborMsg: HarborInboundMessage) => {
      const room = harborMsg.room || 'main';
      const chatJid = `${HARBOR_JID_PREFIX}${room}`;
      const timestamp = harborMsg.timestamp || new Date().toISOString();

      // Emit chat metadata so NanoClaw knows about this chat
      this.opts.onChatMetadata(
        chatJid,
        timestamp,
        `Harbor #${room}`,
        'harbor',
        false, // Not a group chat in the traditional sense — it's spatial
      );

      // Check if this JID maps to a registered group
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        // Not registered — ignore silently (NanoClaw only processes registered chats)
        return;
      }

      // Build the NanoClaw message
      const message: NewMessage = {
        id: `harbor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        chat_jid: chatJid,
        sender: harborMsg.sender,
        sender_name: harborMsg.sender,
        content: harborMsg.content,
        timestamp,
        is_from_me: false,
      };

      this.opts.onMessage(chatJid, message);
    });

    console.log(`\n  Harbor channel: connected to ${this.serverUrl}`);
    console.log(`  Harbor JID format: harbor:<room> (e.g. harbor:main)\n`);
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.ownsJid(jid)) return;
    if (!isAdapterConnected()) {
      console.warn('[harbor-channel] Cannot send — adapter not connected');
      return;
    }

    // Extract room from JID, derive agent name from registered group
    const room = jid.replace(HARBOR_JID_PREFIX, '');
    const group = this.opts.registeredGroups()[jid];
    const agentId = group?.assistantName?.toLowerCase() || group?.name || 'margot';

    sendToHarbor(agentId, text);
  }

  isConnected(): boolean {
    return isAdapterConnected();
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(HARBOR_JID_PREFIX);
  }

  async disconnect(): Promise<void> {
    await disconnectAdapter();
    console.log('  Harbor channel: disconnected');
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.ownsJid(jid) || !isAdapterConnected()) return;

    const group = this.opts.registeredGroups()[jid];
    const agentId = group?.assistantName?.toLowerCase() || group?.name || 'margot';

    // Typing → working animation in Harbor; not typing → idle
    updateAgentPresence(agentId, isTyping ? 'thinking' : 'idle');
  }
}

// --- Self-registration ---
// NanoClaw loads all channel modules at startup; each calls registerChannel()
// to make itself available. The factory returns null if config is missing,
// which means Harbor won't activate unless HARBOR_SERVER_URL + HARBOR_ADAPTER_TOKEN are set.

registerChannel('harbor', (opts: ChannelOpts) => {
  const serverUrl =
    process.env.HARBOR_SERVER_URL || `http://localhost:${DEFAULT_HARBOR_PORT}`;
  const token = process.env.HARBOR_ADAPTER_TOKEN || '';

  if (!token) {
    // No token configured — Harbor channel is opt-in, not an error
    return null;
  }

  return new HarborChannel(serverUrl, token, opts);
});
