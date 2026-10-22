declare module 'heic2any' {
  export interface Heic2AnyOptions {
    blob: Blob;
    toType?: 'image/jpeg' | 'image/png';
    quality?: number;
    multiple?: false;
  }

  export interface Heic2AnyMultipleOptions {
    blob: Blob;
    toType?: 'image/jpeg' | 'image/png';
    quality?: number;
    multiple: true;
  }

  function heic2any(options: Heic2AnyOptions): Promise<Blob>;
  function heic2any(options: Heic2AnyMultipleOptions): Promise<Blob[]>;

  export default heic2any;
}

