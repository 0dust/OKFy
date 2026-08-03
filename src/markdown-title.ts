import type GithubSlugger from "github-slugger";

export function needsGeneratedTitle(markdown: string): boolean {
  return !markdown.trimEnd().match(/^#\s+/);
}

export function slugGeneratedTitle(slugger: GithubSlugger, title: string): string {
  return slugger.slug(title);
}
