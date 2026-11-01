---
title: Devices connect out to the gateway
description: Each node agent opens and holds a connection to the gateway; the gateway never dials a device.
status: accepted
sidebar:
  order: 2
---

# Devices connect out to the gateway

Each node agent opens and holds a connection to the gateway; the gateway never dials a device. This means a device needs no inbound port or firewall rule, local model servers stay on localhost, and a device is listed exactly while its tunnel is open. We rejected the original shape (the gateway calling each device's address) because every new device needed a firewall rule and its model server exposed to the network. The cost is that the gateway must multiplex model requests and tool calls over the tunnel (built in issues #3, #5, #6, #8, #9 and #10).
