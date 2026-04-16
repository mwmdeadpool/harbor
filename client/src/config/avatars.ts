export interface AgentAvatarConfig {
  /** URL to a .vrm file. Empty string means use procedural fallback. */
  vrmUrl?: string;
  /** Uniform scale applied to the VRM model. Default: 1.0 */
  scale?: number;
  /** Position offset [x, y, z] applied to the VRM model. Default: [0, 0, 0] */
  offset?: [number, number, number];
}

/**
 * Per-agent avatar configuration.
 * Populate vrmUrl when VRM files are available.
 */
export const AGENT_AVATARS: Record<string, AgentAvatarConfig> = {
  margot: {
    vrmUrl: '',
    scale: 1.0,
    offset: [0, 0, 0],
  },
  bud: {
    vrmUrl: '',
    scale: 1.0,
    offset: [0, 0, 0],
  },
  lou: {
    vrmUrl: '',
    scale: 1.0,
    offset: [0, 0, 0],
  },
  nygma: {
    vrmUrl: '',
    scale: 1.0,
    offset: [0, 0, 0],
  },
  ivy: {
    vrmUrl: '',
    scale: 1.0,
    offset: [0, 0, 0],
  },
  harvey: {
    vrmUrl: '',
    scale: 1.0,
    offset: [0, 0, 0],
  },
};
