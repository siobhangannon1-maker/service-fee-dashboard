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

export async function getTrelloBoardLists() {
  const apiKey = process.env.TRELLO_API_KEY;
  const token = process.env.TRELLO_TOKEN;

  const boardIds = [
    ...(process.env.TRELLO_BOARD_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    ...(process.env.TRELLO_BOARD_ID ? [process.env.TRELLO_BOARD_ID] : []),
  ];

  const uniqueBoardIds = Array.from(new Set(boardIds));

  if (!apiKey) {
    throw new Error("Missing TRELLO_API_KEY.");
  }

  if (!token) {
    throw new Error("Missing TRELLO_TOKEN.");
  }

  if (uniqueBoardIds.length === 0) {
    throw new Error("Missing TRELLO_BOARD_ID or TRELLO_BOARD_IDS.");
  }

  const allLists: any[] = [];

  for (const boardId of uniqueBoardIds) {
    const boardResponse = await fetch(
      `https://api.trello.com/1/boards/${boardId}?key=${apiKey}&token=${token}&fields=id,name,url,closed`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    const boardText = await boardResponse.text();

    let board: any = null;

    try {
      board = JSON.parse(boardText);
    } catch {
      throw new Error(
        `Trello board ${boardId} did not return JSON: ${boardText.slice(
          0,
          200,
        )}`,
      );
    }

    if (!boardResponse.ok) {
      throw new Error(board?.message || `Could not fetch board ${boardId}.`);
    }

    const listsResponse = await fetch(
      `https://api.trello.com/1/boards/${boardId}/lists?key=${apiKey}&token=${token}&fields=id,name,idBoard,closed`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    const listsText = await listsResponse.text();

    let lists: any[] = [];

    try {
      lists = JSON.parse(listsText);
    } catch {
      throw new Error(
        `Trello lists for board ${boardId} did not return JSON: ${listsText.slice(
          0,
          200,
        )}`,
      );
    }

    if (!listsResponse.ok) {
      throw new Error(
        Array.isArray(lists)
          ? `Could not fetch lists for board ${boardId}.`
          : (lists as any)?.message || `Could not fetch lists for ${boardId}.`,
      );
    }

    for (const list of lists) {
      if (list.closed === true) continue;

      allLists.push({
        id: list.id,
        name: list.name,
        idBoard: list.idBoard,
        board_id: board.id,
        board_name: board.name,
        board_url: board.url,
      });
    }
  }

  return allLists;
}