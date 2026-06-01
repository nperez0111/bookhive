declare module "*.html" {
  const value: import("bun").HTMLBundle;
  export default value;
}

declare module "*.css" {
  const value: string;
  export default value;
}
