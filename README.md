# Nart Jnr

Personal AI assistant built for Coach Nart.

Nart Jnr connects WhatsApp to an AI brain with persistent memory, conversation context, automatic AI-provider fallback, and private one-to-one conversations.

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
- 📱 Designed to run continuously on a server or Android/Termux

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
   ├── Memory
   ├── Conversation Context
   │
   ▼
Nart Jnr Brain
   │
   ├── OpenRouter
   │
   └── Gemini fallback
   │
   ▼
Response
   │
   ▼
WhatsApp

nart-jnr/
├── data/
│   ├── conversations/
│   ├── memory.json
│   └── whatsapp-auth/
│
├── src/
│   ├── core/
│   │   ├── brain.js
│   │   ├── context.js
│   │   └── memory.js
│   │
│   ├── providers/
│   │   ├── gemini.js
│   │   └── openrouter.js
│   │
│   ├── whatsapp/
│   │   ├── index.js
│   │   └── test.js
│   │
│   ├── config.js
│   └── index.js
│
├── .env
├── .gitignore
├── package.json
└── README.md
GEMINI_API_KEY=
OPENROUTER_API_KEY=

GEMINI_MODEL=gemini-3.6-flash
OPENROUTER_MODEL=openrouter/free

OWNER_NAME=Coach Nart
ASSISTANT_NAME=Nart Jnr
MAX_HISTORY=16
