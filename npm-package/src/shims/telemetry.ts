// No-op replacement for shared/telemetry.ts. The published library must not
// emit any telemetry to Fan Pier Labs' analytics — consumers run this in
// their own apps and would not expect outbound analytics calls from a
// scraper library.
export function sendTelemetryEvent(event: string, props?: Record<string, unknown>): void {
  void event;
  void props;
}

export interface EnvInfo {
  public_ip: string | null;
  platform: string;
  arch: string;
  runtime_version: string;
  os_version: string;
  hostname: string;
  git_user_name: string | null;
  git_user_email: string | null;
  env_user: string | null;
}

export async function gatherEnvInfo(): Promise<EnvInfo> {
  return {
    public_ip: null,
    platform: '',
    arch: '',
    runtime_version: '',
    os_version: '',
    hostname: '',
    git_user_name: null,
    git_user_email: null,
    env_user: null,
  };
}
