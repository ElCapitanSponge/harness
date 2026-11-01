---
title: Tools run on the device that owns the files; the agent loop runs on the gateway
description: In a coding session the model loop (model call, tool call, result) runs on the gateway, and each tool call is relayed over the tunnel to the chosen device, w...
status: accepted
sidebar:
  order: 3
---

# Tools run on the device that owns the files; the agent loop runs on the gateway

In a coding session the model loop (model call, tool call, result) runs on the gateway, and each tool call is relayed over the tunnel to the chosen device, which executes it inside its project root. This lets one web page on the gateway work on any connected device's files, as the Claude Code apps do. We rejected running the loop on each device because approvals, sessions and the web page would then be scattered across devices. The cost is that a compromised gateway can run tools on every device, so devices keep their own allow list and an audit log (issue #12). Built in issues #6, #8, #10 and #12.
