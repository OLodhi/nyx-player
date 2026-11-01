package com.nyxplayer.nativebridge

/**
 * Lecture des messages de libmpv, sans appel Android (testée sur la JVM, MpvLogPolicyTest) :
 * code HTTP d'un flux refusé, ouverture ratée, son qui décroche, aucun décodeur.
 */
internal object MpvLogPolicy {
    private val HTTP_ERROR = Regex("""HTTP error (\d{3})""")
    private val SERVER_RETURNED = Regex("""Server returned (\d{3})""")
    private val OPEN_FAILURE = Regex("""Failed to open|Opening failed|Failed to recognize file format|No such file""")
    private val AUDIO_TROUBLE = Regex("""Audio device underrun|Audio/Video desynchronisation""")
    private val DECODER_FAILURE = Regex("""Failed to initialize a decoder for codec""")

    /** « HTTP error 404 … » : ce code remplace le précédent. */
    fun httpErrorStatus(line: String): Int? = HTTP_ERROR.find(line)?.groupValues?.get(1)?.toIntOrNull()

    /** « Server returned 403 … » : ce code ne sert que si aucun autre n'a été lu pour ce flux. */
    fun serverReturnedStatus(line: String): Int? = SERVER_RETURNED.find(line)?.groupValues?.get(1)?.toIntOrNull()

    fun isOpenFailure(line: String): Boolean = OPEN_FAILURE.containsMatchIn(line)

    /** Son qui décroche (« Audio device underrun », désynchronisation) : signal de la surveillance de fluidité. */
    fun isAudioTrouble(line: String): Boolean = AUDIO_TROUBLE.containsMatchIn(line)

    /**
     * Aucun décodeur (matériel puis logiciel) n'a pu lire la vidéo : le codec en cause, pour le
     * message de l'interface (peut être vide), ou null si la ligne ne dit pas cela.
     */
    fun decoderFailureCodec(line: String): String? =
        if (DECODER_FAILURE.containsMatchIn(line)) line.substringAfter("codec", "").trim(' ', '\'', '.') else null
}
