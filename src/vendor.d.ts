declare module "robots-parser" {
  export type Robot = {
    isAllowed(url: string, userAgent?: string): boolean;
  };

  export default function robotsParser(url: string, contents: string): Robot;
}
