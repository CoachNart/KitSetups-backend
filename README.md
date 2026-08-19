# Nart Jnr

> Coach Nart's personal AI assistant for WhatsApp.

Nart Jnr is a personal AI assistant built with Node.js and WhatsApp. It combines AI-powered conversations with persistent memory, conversation context, intelligent provider routing, and private one-to-one messaging.

## Features

- 🤖 AI-powered WhatsApp assistant
- ⚡ OpenRouter as the primary AI provider
- 🛟 Gemini as an optional fallback
- 🧠 Persistent long-term memory
- 💬 Per-user conversation history
- 🎯 Context-aware conversations
- 👤 Personalized owner identity
- 🛡️ WhatsApp group protection
- 🚫 Broadcast/status protection
- 🔐 Environment-based API credentials
- 🔄 Automatic WhatsApp reconnection
- ✍️ Typing presence while generating responses
- 🧩 Modular provider architecture
- 📱 Designed to run on Android/Termux or a server

## Architecture

```text
WhatsApp
    │
    ▼
  Baileys
    │
    ▼
WhatsApp Handler
    │
    ├── Group Firewall
    ├── Message Protection
    │
    ▼
Nart Jnr Brain
    │
    ├── Memory
    ├── Conversation Context
    │
    ▼
AI Provider
    │
    ├── OpenRouter
    │       Primary
    │
    └── Gemini
            Fallback
    │
    ▼
Response
    │
    ▼
WhatsApp
