from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application configuration loaded from environment variables."""

    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o"
    llm_api_key: str = ""
    tick_interval: float = 4.0
    db_path: str = "office_agents.db"
    allowed_file_paths: list[str] = []
    tavily_api_key: str = ""

    model_config = {
        "env_prefix": "OFFICE_AGENTS_",
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }


settings = Settings()
