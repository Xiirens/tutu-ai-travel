import asyncio

from back.core.gpt_client import generate_reply
from back.core.proxy import create_proxy_client, verify_proxy


async def main() -> None:
    async with create_proxy_client() as client:
        proxy_ip = await verify_proxy(client)
        answer, response_id = await generate_reply(
            client,
            "Привет! Коротко представься и спроси, куда я хочу поехать.",
        )

    print(f"Proxy IP: {proxy_ip}")
    print(f"OpenAI response ID: {response_id}")
    print(answer.model_dump_json(indent=2))


if __name__ == "__main__":
    asyncio.run(main())
