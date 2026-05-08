type TrelloCreateCardInput = {
  name: string;
  desc: string;
  idList: string;
  due?: string | null;
  pos?: "top" | "bottom";
  labels?: string[];
};

type TrelloAttachUrlInput = {
  cardId: string;
  url: string;
  name?: string;
};

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getTrelloConfig() {
  return {
    key: requireEnv("TRELLO_API_KEY"),
    token: requireEnv("TRELLO_TOKEN"),
    boardId: process.env.TRELLO_BOARD_ID || "",
    defaultListId: requireEnv("TRELLO_DEFAULT_LIST_ID"),
  };
}

export async function createTrelloCard(input: TrelloCreateCardInput) {
  const config = getTrelloConfig();

  const params = new URLSearchParams({
    key: config.key,
    token: config.token,
    idList: input.idList,
    name: input.name,
    desc: input.desc,
    pos: input.pos || "top",
  });

  if (input.due) {
    params.set("due", input.due);
  }

  if (input.labels?.length) {
    params.set("idLabels", input.labels.join(","));
  }

  const response = await fetch("https://api.trello.com/1/cards", {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
    body: params,
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Trello card creation failed: ${response.status} ${text}`);
  }

  return JSON.parse(text);
}

export async function addUrlAttachmentToTrelloCard(input: TrelloAttachUrlInput) {
  const config = getTrelloConfig();

  const params = new URLSearchParams({
    key: config.key,
    token: config.token,
    url: input.url,
  });

  if (input.name) {
    params.set("name", input.name);
  }

  const response = await fetch(
    `https://api.trello.com/1/cards/${input.cardId}/attachments`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      body: params,
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Trello attachment upload failed: ${response.status} ${text}`
    );
  }

  return JSON.parse(text);
}

export async function addCommentToTrelloCard({
  cardId,
  text,
}: {
  cardId: string;
  text: string;
}) {
  const config = getTrelloConfig();

  const params = new URLSearchParams({
    key: config.key,
    token: config.token,
    text,
  });

  const response = await fetch(
    `https://api.trello.com/1/cards/${cardId}/actions/comments`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      body: params,
    }
  );

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Trello comment failed: ${response.status} ${responseText}`
    );
  }

  return JSON.parse(responseText);
}

export async function getTrelloBoardLists(boardId?: string) {
  const config = getTrelloConfig();
  const targetBoardId = boardId || config.boardId;

  if (!targetBoardId) {
    throw new Error("Missing TRELLO_BOARD_ID.");
  }

  const params = new URLSearchParams({
    key: config.key,
    token: config.token,
    fields: "name,id",
  });

  const response = await fetch(
    `https://api.trello.com/1/boards/${targetBoardId}/lists?${params.toString()}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Trello lists fetch failed: ${response.status} ${text}`);
  }

  return JSON.parse(text);
}
