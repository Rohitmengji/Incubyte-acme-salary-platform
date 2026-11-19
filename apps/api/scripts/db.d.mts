export declare const repoRoot: string;
export declare const LOCAL_DB: {
  host: string;
  port: number;
  user: string;
  password: string;
  databases: string[];
};
export declare function start(options?: { quiet?: boolean }): Promise<void>;
export declare function stop(): Promise<void>;
/** A setting from the environment, else from apps/api/.env. */
export declare function setting(name: string): string | undefined;
