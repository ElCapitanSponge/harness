---
title: Pooling routes whole requests; it never splits a model across devices
description: "\"Pooling\" means a request goes to one device that already has the model loaded."
sidebar:
  order: 5
---

# Pooling routes whole requests; it never splits a model across devices

"Pooling" means a request goes to one device that already has the model loaded. We did not pursue splitting one model across devices over the network: the link between them is far slower than memory, so the result would be slower than the single best device and much more fragile. Larger models are handled by choosing the device with the most memory, or by using Claude.
