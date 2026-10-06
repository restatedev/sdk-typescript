//! napi-rs binding for the embedded relay-tunnel receiver.
//!
//! A thin control-plane wrapper around `restate_sdk_shared_core::relay`
//! (`Engine`/`Handle`) — the same engine the sdk-java FFM cdylib drives. Every
//! forwarded request rides a loopback socket inside the engine's own tokio
//! runtime; this binding only exposes start / status / stop. The high-level
//! node:http2 wiring lives in the TypeScript wrapper (`restate/index.ts`).

use napi_derive::napi;
use restate_sdk_shared_core::relay::{Config, Engine, Handle};

/// A running relay tunnel. Construct with [`RelayTunnel::start`]; stop with
/// [`RelayTunnel::stop`] (idempotent) or by letting it be garbage-collected
/// (the underlying engine's `Drop` also shuts down).
#[napi]
pub struct RelayTunnel {
    handle: Option<Handle>,
}

#[napi]
impl RelayTunnel {
    /// Parse the JSON config (the `relay::Config` shape: `relay_addr`, `env`,
    /// `tunnel`, `api_key`, `local_port`, optional `connections`/`instance_id`/
    /// `tls`/…) and start the engine. Returns immediately; the receiver dials
    /// the relay in the background.
    #[napi(factory)]
    pub fn start(config_json: String) -> napi::Result<RelayTunnel> {
        let config: Config = serde_json::from_str(&config_json)
            .map_err(|e| napi::Error::from_reason(format!("invalid tunnel config JSON: {e}")))?;
        let handle = Engine::start(config).map_err(|e| napi::Error::from_reason(e.to_string()))?;
        Ok(RelayTunnel {
            handle: Some(handle),
        })
    }

    /// Engine status as JSON: `{"running": bool, "last_error": string|null}`.
    #[napi]
    pub fn status(&self) -> String {
        match &self.handle {
            Some(h) => h.status_json(),
            None => r#"{"running":false,"last_error":null}"#.to_string(),
        }
    }

    /// Signal a graceful shutdown and join the engine's runtime. Idempotent —
    /// a second call (or GC after this) is a no-op. Blocks briefly while the
    /// runtime drains, so call it off any hot path.
    #[napi]
    pub fn stop(&mut self) {
        if let Some(mut h) = self.handle.take() {
            h.stop();
        }
    }
}
