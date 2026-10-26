package com.threadkeeper.slopgrenade.accounts

/** Metadata-only storage contract, also used by deterministic scan transaction tests. */
interface AccountRepository {
    fun all(): List<AccountState>
    fun put(account: AccountState)
    fun remove(id: String)
}
