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
