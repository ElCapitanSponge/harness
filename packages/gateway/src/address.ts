// Working out which connected device is the one a browser is on: by the address each connects from. Behind a container's port
// publishing every browser can look like the container network's gateway, so the match is a convenience, and the person can always
// say which device this is.

// An address in one comparable form: no IPv4-in-IPv6 prefix, no zone, and every loopback address the same.
export const normalizeAddress = (raw: string | undefined): string | undefined => {
  if (!raw) {
    return undefined;
  }
  let address = raw.trim().toLowerCase().replace(/%.*$/, "");
  if (address.startsWith("::ffff:") && address.includes(".")) {
    address = address.slice(7);
  }
  return address === "::1" || address.startsWith("127.") ? "loopback" : address;
};

// An address in the range containers get from the runtime (172.16.0.0/12). A browser that shows up as one is probably behind port
// publishing, where its real address is not visible.
export const looksLikeContainerNetwork = (address: string | undefined): boolean => {
  return address !== undefined && /^172\.(1[6-9]|2\d|3[01])\./.test(address);
};

// The address the request came from. Behind a trusted reverse proxy it is the first one the proxy reports; otherwise the connection's.
export const callerAddress = (connection: string | undefined, forwardedFor: string | undefined, trustProxy: boolean): string | undefined => {
  const forwarded = trustProxy ? forwardedFor?.split(",")[0] : undefined;
  return normalizeAddress(forwarded ?? connection);
};
