declare module "*.html" {
  const value: import("bun").HTMLBundle;
  export default value;
}
