# Progress while a request is in flight

From the moment Send is pressed the page shows one status line with a running timer, so a slow model load reads as work in progress and not a hang. The gateway reports each **stage** as a live event on the conversation's event stream (`type: "stage"`), which is never stored or replayed:

| Stage | Meaning | Detail |
| --- | --- | --- |
| (sending) | The message has left the page; no event has come back yet. | |
| `routing` | Finding a device for the model. | the model |
| `freeing` | Unloading another model so this one fits. | the model being unloaded |
| `loading` | Loading the model on the device. | the model |
| `waiting` | Sent to the model; no word yet. | the model and device, or Claude and the device it goes through |
| `thinking` | The model has started reasoning. | |
| `writing` | The model has started its reply. | |

A request that cannot be served (no device has the model, the device is busy, the load failed) ends the turn at once with the reason, and the page shows it with a **Retry** button that sends the same message again.

The CLI prints the same stages for `harness code -d <device>` as `... loading qwen` lines on stderr. The OpenAI-compatible `/v1/chat/completions` stream is unchanged, so other clients see no extra lines.
