/**
 * 许可证验签公钥。对应的私钥只存在于发行方（tools/sign-license.mjs 使用），
 * 绝不进入应用包——这是「离线激活」能成立的前提。
 */
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAK06wPblRVi0tJtzPmxKuGxrOhhsofON4S6FxWZ8rrSY=
-----END PUBLIC KEY-----
`
