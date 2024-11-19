/**
 * GENERATED CODE - DO NOT MODIFY
 */
import {
  createServer as createXrpcServer,
  Server as XrpcServer,
  Options as XrpcOptions,
  AuthVerifier,
  StreamAuthVerifier,
} from '@atproto/xrpc-server'
import { schemas } from './lexicons'
import * as BuzzBookhiveSearchBooks from './types/buzz/bookhive/searchBooks'

export const BUZZ_BOOKHIVE = {
  DefsFinished: 'buzz.bookhive.defs#finished',
  DefsReading: 'buzz.bookhive.defs#reading',
  DefsWantToRead: 'buzz.bookhive.defs#wantToRead',
  DefsAbandoned: 'buzz.bookhive.defs#abandoned',
  DefsOwned: 'buzz.bookhive.defs#owned',
}

export function createServer(options?: XrpcOptions): Server {
  return new Server(options)
}

export class Server {
  xrpc: XrpcServer
  buzz: BuzzNS
  app: AppNS
  com: ComNS

  constructor(options?: XrpcOptions) {
    this.xrpc = createXrpcServer(schemas, options)
    this.buzz = new BuzzNS(this)
    this.app = new AppNS(this)
    this.com = new ComNS(this)
  }
}

export class BuzzNS {
  _server: Server
  bookhive: BuzzBookhiveNS

  constructor(server: Server) {
    this._server = server
    this.bookhive = new BuzzBookhiveNS(server)
  }
}

export class BuzzBookhiveNS {
  _server: Server

  constructor(server: Server) {
    this._server = server
  }

  searchBooks<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      BuzzBookhiveSearchBooks.Handler<ExtractAuth<AV>>,
      BuzzBookhiveSearchBooks.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'buzz.bookhive.searchBooks' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }
}

export class AppNS {
  _server: Server
  bsky: AppBskyNS

  constructor(server: Server) {
    this._server = server
    this.bsky = new AppBskyNS(server)
  }
}

export class AppBskyNS {
  _server: Server
  actor: AppBskyActorNS

  constructor(server: Server) {
    this._server = server
    this.actor = new AppBskyActorNS(server)
  }
}

export class AppBskyActorNS {
  _server: Server

  constructor(server: Server) {
    this._server = server
  }
}

export class ComNS {
  _server: Server
  atproto: ComAtprotoNS

  constructor(server: Server) {
    this._server = server
    this.atproto = new ComAtprotoNS(server)
  }
}

export class ComAtprotoNS {
  _server: Server
  repo: ComAtprotoRepoNS

  constructor(server: Server) {
    this._server = server
    this.repo = new ComAtprotoRepoNS(server)
  }
}

export class ComAtprotoRepoNS {
  _server: Server

  constructor(server: Server) {
    this._server = server
  }
}

type SharedRateLimitOpts<T> = {
  name: string
  calcKey?: (ctx: T) => string
  calcPoints?: (ctx: T) => number
}
type RouteRateLimitOpts<T> = {
  durationMs: number
  points: number
  calcKey?: (ctx: T) => string
  calcPoints?: (ctx: T) => number
}
type HandlerOpts = { blobLimit?: number }
type HandlerRateLimitOpts<T> = SharedRateLimitOpts<T> | RouteRateLimitOpts<T>
type ConfigOf<Auth, Handler, ReqCtx> =
  | Handler
  | {
      auth?: Auth
      opts?: HandlerOpts
      rateLimit?: HandlerRateLimitOpts<ReqCtx> | HandlerRateLimitOpts<ReqCtx>[]
      handler: Handler
    }
type ExtractAuth<AV extends AuthVerifier | StreamAuthVerifier> = Extract<
  Awaited<ReturnType<AV>>,
  { credentials: unknown }
>
