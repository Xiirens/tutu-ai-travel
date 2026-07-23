import asyncio

from back.core.proxy import create_proxy_client, verify_proxy


async def main() -> None:
    async with create_proxy_client() as client:
        ip = await verify_proxy(client)
    print(f"Proxy verified. Outbound IP: {ip}")


if __name__ == "__main__":
    asyncio.run(main())
