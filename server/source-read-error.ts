export class SourceReadError extends Error {
  constructor(message:string,readonly code:string,options?:ErrorOptions){super(message,options);}
}
