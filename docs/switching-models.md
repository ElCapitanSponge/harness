# Switching models inside a conversation

The model is chosen for each message, not once for the conversation. Next to the message box, **Next message goes to** shows the model the conversation is on; pick another and that message, and the ones after it, go there. It can be a model on any connected device, or Claude.

- **The whole history goes along.** Each model sees everything said before, including what other models answered, so a chat can start on a small local model, move to a larger one on another machine for a hard question, and use Claude for a review.
- **Each reply says who wrote it.** A reply is labelled with its model and the device it ran on, and the label is kept when the conversation is reopened. The conversation's own model (shown in the header and the sidebar) is the one that answered last.
- **A model that is not loaded is loaded first**, on its device, exactly as when you start a conversation with it. The status line shows the freeing and loading.
- **Coding sessions** can move between local models on any device that is connected, and to Claude, which drives the same tool loop (see [claude.md](claude.md)).
- **It must fit.** Windows differ between models. Before the call, the gateway measures the conversation against the window of the model that is about to answer. If it is nearly full there, the conversation is compacted first (see [usage.md](usage.md)), using that model. If it still cannot fit, the turn stops at once with a message saying how many tokens it is, how many the model holds, and what to do. Nothing is sent to a model that would reject it.

Through the API, `POST /sessions/:id/messages` takes `{ "text": "...", "model": "gemma-3-12b" }`; leave `model` out to stay on the current one.

Not a council: one model answers each message. Orchestrating several models on one request is not planned.
