---
status: accepted
---

# Devices connect out to the gateway

Each node agent opens and holds a connection to the gateway; the gateway never dials a device. This means a device needs no inbound port or firewall rule, local model servers stay on localhost, and a device is listed exactly while its tunnel is open. We rejected the original shape (the gateway calling each device's address) because every new device needed a firewall rule and its model server exposed to the network. The cost is that the gateway must multiplex model requests and tool calls over the tunnel (issues #3 and #5; the tunnel for registration exists, request relay does not yet).
