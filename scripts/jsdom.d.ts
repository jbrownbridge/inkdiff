// jsdom ships no types and @types/jsdom is not a dependency; capture-classic only needs JSDOM.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html: string);
    window: { document: Document };
  }
}
