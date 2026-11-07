#pragma once
#include <stddef.h>

// src/ios_ca.rs: Mozilla's root certificates (webpki-root-certs), as DER
size_t nyx_ios_root_cert_count(void);
const unsigned char *nyx_ios_root_cert(size_t index, size_t *len);
