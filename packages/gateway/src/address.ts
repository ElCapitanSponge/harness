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

export interface Interface {
  address: string;
  netmask: string;
  family: string;
  internal: boolean;
}

const toNumber = (ip: string): number => {
  return ip.split(".").reduce((n, part) => {
    return n * 256 + Number(part);
  }, 0);
};

// True when the address is on a container network the gateway itself is attached to (an interface of its own in the 172.x range that
// contains the address). Port publishing hides every browser behind the address of that network's gateway, so such an address says
// nothing about which machine the browser is on: a device that connected from it is no more the browser's than any other.
export const onOwnContainerNetwork = (address: string | undefined, interfaces: Interface[]): boolean => {
  if (address === undefined || !/^\d+\.\d+\.\d+\.\d+$/.test(address)) {
    return false;
  }
  return interfaces.some((i) => {
    if (i.internal || i.family !== "IPv4" || !i.address.startsWith("172.")) {
      return false;
    }
    const mask = toNumber(i.netmask);
    return (toNumber(address) & mask) === (toNumber(i.address) & mask);
  });
};

// The address the request came from. Behind a trusted reverse proxy it is the first one the proxy reports; otherwise the connection's.
export const callerAddress = (connection: string | undefined, forwardedFor: string | undefined, trustProxy: boolean): string | undefined => {
  const forwarded = trustProxy ? forwardedFor?.split(",")[0] : undefined;
  return normalizeAddress(forwarded ?? connection);
};
