package com.dhruvgoel.habitloop.shared

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Signs partner events the way the Integration Service verifies them: the HMAC key is the
 * SHA-256 digest of the link's ingest key, and the header is "sha256=" plus the lowercase hex MAC.
 */
object HmacSigner {
    fun sign(body: String, ingestKey: String): String {
        val keyBytes: ByteArray = MessageDigest.getInstance("SHA-256").digest(ingestKey.toByteArray(Charsets.UTF_8))
        val mac: Mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(keyBytes, "HmacSHA256"))
        val out: ByteArray = mac.doFinal(body.toByteArray(Charsets.UTF_8))
        return "sha256=" + out.joinToString("") { "%02x".format(it) }
    }
}
