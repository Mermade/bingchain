import env from "dotenv";
env.config();

import fs from "fs";
import { Parser } from "expr-eval";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
const rl = readline.createInterface({ input, output });

const promptTemplate = fs.readFileSync("prompt.txt", "utf8");
const mergeTemplate = fs.readFileSync("merge.txt", "utf8");

const colour = (process.env.NODE_DISABLE_COLORS || !process.stdout.isTTY) ?
    { red: '', yellow: '', green: '', normal: '' } :
    { red: '\x1b[31m', yellow: '\x1b[33;1m', green: '\x1b[32m', normal: '\x1b[0m' };

// use Microsoft Bing to answer the question
const bingSearch = async (question) =>
  await fetch(
    `https://api.bing.microsoft.com/v7.0/search?q=${escape(question)}`, { headers: {"Ocp-Apim-Subscription-Key": process.env.BING_API_KEY } })
    .then((res) => res.json())
    .then(
      (res) => {
        // try to pull the answer from various components of the response
        return res.webPages.value[0].snippet
      }
    );

// tools that can be used to answer questions
const tools = {
  search: {
    description:
      "A search engine. Useful for when you need to answer questions about current events or retrieve in-depth answers. Input should be a search query.",
    execute: bingSearch,
  },
  calculator: {
    description:
      "Useful for getting the result of a math expression. The input to this tool should be a valid mathematical expression that could be executed by a simple calculator.",
    execute: (input) => Parser.evaluate(input).toString(),
  },
};

// use GPT-3.5 to complete a given prompts
const completePrompt = async (prompt) =>
  await fetch("https://api.openai.com/v1/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + process.env.OPENAI_API_KEY,
    },
    body: JSON.stringify({
      model: "text-davinci-003",
      prompt,
      max_tokens: 256,
      temperature: 0.7,
      stream: false,
      stop: ["Observation:"],
    }),
  })
    .then((res) => res.json())
    .then((res) => res.choices[0].text)
    .then((res) => {
      console.log("\x1b[91m" + prompt + "\x1b[0m");
      console.log("\x1b[92m" + res + "\x1b[0m");
      return res;
    });

const answerQuestion = async (question) => {
  // construct the prompt, with our question and the tools that the chain can use
  let prompt = promptTemplate.replace("${question}", question).replace(
    "${tools}",
    Object.keys(tools)
      .map((toolname) => `${toolname}: ${tools[toolname].description}`)
      .join("\n")
  );

  // allow the LLM to iterate until it finds a final answer
  while (true) {
    const response = await completePrompt(prompt);

    // add this to the prompt
    prompt += response;

    const action = response.match(/Action: (.*)/)?.[1];
    if (action) {
      // execute the action specified by the LLMs
      const actionInput = response.match(/Action Input: "?(.*)"?/)?.[1];
      const result = await tools[action.trim()].execute(actionInput);
      prompt += `Observation: ${result}\n`;
    } else {
      return response.match(/Final Answer: (.*)/)?.[1];
    }
  }
};

// merge the chat history with a new question
const mergeHistory = async (question, history) => {
  const prompt = mergeTemplate
    .replace("${question}", question)
    .replace("${history}", history);
  return await completePrompt(prompt);
};

// main loop - answer the user's questions
let history = "";
while (true) {
  let question = await rl.question(`${colour.red}How can I help? >${colour.yellow} `);
  if (history.length > 0) {
    question = await mergeHistory(question, history);
  }
  const answer = await answerQuestion(question);
  console.log(`${colour.green}${answer}`);
  history += `Q:${question}\nA:${answer}\n`;
}
