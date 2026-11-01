use hickory_resolver::config::{ResolverConfig, CLOUDFLARE, QUAD9};
use hickory_resolver::net::runtime::TokioRuntimeProvider;
use hickory_resolver::TokioResolver;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::net::SocketAddr;

// ============= DNS-over-HTTPS Cascade Resolver =============

/// Resolver DNS avec cascade DoH : essaie chaque resolver avec timeout 3s,
/// puis fallback vers le DNS système si tous les DoH échouent.
/// Sert au catalogue et au guide TV (`http.rs`). La lecture vidéo (mpv, FFmpeg) résout par le DNS
/// de l'appareil : le réglage « DNS sécurisé » ne la concerne pas.
pub(crate) struct CascadeDohResolver {
    resolvers: Vec<TokioResolver>,
}

impl CascadeDohResolver {
    /// Crée un resolver cascade selon le provider choisi.
    /// - "cloudflare" → CF → Q9 → système
    /// - "quad9" → Q9 → CF → système
    /// - "system" ou autre → None (pas de custom resolver)
    pub fn new(provider: &str) -> Option<Self> {
        let configs = match provider {
            "cloudflare" => vec![
                ResolverConfig::https(&CLOUDFLARE),
                ResolverConfig::https(&QUAD9),
            ],
            "quad9" => vec![
                ResolverConfig::https(&QUAD9),
                ResolverConfig::https(&CLOUDFLARE),
            ],
            _ => return None,
        };
        // Échec de construction (configuration TLS du DoH) : ce résolveur est sauté, la cascade
        // continue avec le suivant puis le DNS système.
        let resolvers: Vec<TokioResolver> = configs
            .into_iter()
            .filter_map(|c| {
                TokioResolver::builder_with_config(c, TokioRuntimeProvider::default())
                    .build()
                    .map_err(|e| {
                        log::warn!("[DNS Cascade] Résolveur DoH indisponible");
                        log::debug!("[DNS Cascade] Résolveur DoH indisponible : {}", e);
                    })
                    .ok()
            })
            .collect();
        Some(Self { resolvers })
    }
}

impl Resolve for CascadeDohResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let resolvers = self.resolvers.clone();
        let hostname = name.as_str().to_string();
        Box::pin(async move {
            // Cascade DoH avec timeout 3s par resolver
            for (i, resolver) in resolvers.iter().enumerate() {
                match tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    resolver.lookup_ip(hostname.as_str()),
                )
                .await
                {
                    Ok(Ok(lookup)) => {
                        let ips: Vec<SocketAddr> =
                            lookup.iter().map(|ip| SocketAddr::new(ip, 0)).collect();
                        log::debug!(
                            "[DNS Cascade] Résolu via DoH #{}: {} → {}",
                            i + 1,
                            hostname,
                            ips.first().map(|a| a.ip().to_string()).unwrap_or_default()
                        );
                        let addrs: Addrs = Box::new(ips.into_iter());
                        return Ok(addrs);
                    }
                    Ok(Err(e)) => {
                        log::warn!("[DNS Cascade] DoH #{} en échec", i + 1);
                        log::debug!(
                            "[DNS Cascade] DoH #{} erreur pour {}: {}",
                            i + 1,
                            hostname,
                            e
                        );
                    }
                    Err(_) => {
                        log::warn!("[DNS Cascade] DoH #{} timeout (3s)", i + 1);
                    }
                }
            }
            // Tous les DoH ont échoué → fallback DNS système
            log::warn!("[DNS Cascade] Fallback DNS système");
            log::debug!("[DNS Cascade] Fallback DNS système pour {}", hostname);
            let addrs = tokio::net::lookup_host(format!("{}:0", hostname))
                .await
                .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;
            Ok(Box::new(addrs) as Addrs)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::CascadeDohResolver;

    /// Réglage « DNS » : Cloudflare ou Quad9 = résolveur sécurisé avec l'autre en secours (puis
    /// le DNS système) ; « system », vide ou valeur inconnue = DNS de l'appareil (aucun résolveur
    /// ajouté). Le nom doit être exact, en minuscules, comme preferencesService.ts l'enregistre.
    /// Seul le nombre de résolveurs est vérifié, pas leur ordre (configuration non exposée).
    #[tokio::test]
    async fn dns_setting_picks_the_secure_cascade() {
        for provider in ["cloudflare", "quad9"] {
            let resolver = CascadeDohResolver::new(provider).expect(provider);
            assert_eq!(resolver.resolvers.len(), 2, "{}", provider);
        }
        for provider in ["system", "", "Cloudflare", "google"] {
            assert!(CascadeDohResolver::new(provider).is_none(), "{:?}", provider);
        }
    }

    /// Journaux visibles par défaut (info, warn, error) : jamais le nom du fournisseur ni son
    /// adresse IP, ni une erreur de résolution qui les cite. Le détail reste en debug.
    #[test]
    fn journaux_visibles_sans_hote_ni_ip() {
        let source = include_str!("dns.rs");
        let code = &source[..source.find("#[cfg(test)]").unwrap()];
        let mut checked = 0;
        for level in ["log::info!(", "log::warn!(", "log::error!("] {
            for (start, _) in code.match_indices(level) {
                let call = &code[start..start + code[start..].find(");").unwrap()];
                for forbidden in ["hostname", "ips", "ip_str", ", e"] {
                    assert!(!call.contains(forbidden), "{call} cite « {forbidden} »");
                }
                checked += 1;
            }
        }
        assert!(checked >= 3, "journaux trouvés : {checked}");
    }
}
