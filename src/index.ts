import { Hono } from 'hono';
import { Bot, webhookCallback, InlineKeyboard } from 'grammy';
import data from './data.json';

// Define environment variable types for Cloudflare Workers
type Env = {
  BOT_TOKEN: string;
  IMAGE_HOST: string;
};

// Store search results for callback queries
const userResults = new Map<number, string[]>();

// Helper function to extract only the text content from the result
function extractTextContent(item: string): string {
  // Extract only the text content after the episode and scene numbers
  const match = item.match(/ep\d+_\d+_(.+)/)
  if (!match) return item;
  
  return match[1];
}

// Helper function to get the image URL from Cloudflare R2
function getImageUrl(item: string, imageHost: string): string {
  return `${imageHost}/bandori_family_${item}.jpg`;
}

// Create a Hono app with typed environment
const app = new Hono<{ Bindings: Env }>();

// Health check endpoint
app.get('/', (c) => c.text('MyGO!!!!! Bot 正在運行中！'));

// Webhook endpoint for Telegram
app.post('/webhook', async (c) => {
  // Create a bot instance using the BOT_TOKEN from environment variables
  const bot = new Bot(c.env.BOT_TOKEN);

  // Handle the /start command
  bot.command('start', (ctx) => {
    return ctx.reply('👋 正在運行中！發送關鍵字來搜尋 MyGO!!!!! 圖片。');
  });

  // Handle the /help command
  bot.command('help', (ctx) => {
    return ctx.reply('發送任何關鍵字，我將搜尋匹配的 MyGO!!!!! 圖片。例如，嘗試發送 "小祥" 或 "愛音"。');
  });

  // Handle text messages for searching
  bot.on('message:text', async (ctx) => {
    const query = ctx.message.text.toLowerCase();
    const userId = ctx.from?.id;
    
    // Search for matches in the data
    const results = data.filter(item => 
      item.toLowerCase().includes(query)
    );
    
    // Store results for this user for callback handling
    if (userId) {
      userResults.set(userId, results);
    }
    
    if (results.length === 0) {
      return ctx.reply('找不到匹配的結果。請嘗試其他關鍵字！');
    }
    
    // If there's only one result, reply with the image
    if (results.length === 1) {
      const textContent = extractTextContent(results[0]);
      const imageUrl = getImageUrl(results[0], c.env.IMAGE_HOST);
      return ctx.replyWithPhoto(imageUrl, {
        caption: textContent
      });
    }
    
    // Limit results to prevent message too long and create inline keyboard
    const limitedResults = results.slice(0, 10);
    const keyboard = new InlineKeyboard();
    
    // Add each result as a button, showing only the text content
    limitedResults.forEach((item, index) => {
      const textContent = extractTextContent(item);
      keyboard.text(textContent, `result_${index}`).row();
    });
    
    // Add navigation buttons if there are more results
    if (results.length > 10) {
      keyboard.text('⬅️ 上一頁', 'prev_page').text('➡️ 下一頁', 'next_page');
    }
    
    // Format the results message
    const message = `找到 ${results.length} 個匹配結果。以下是前 ${limitedResults.length} 個：`;
    
    return ctx.reply(message, { reply_markup: keyboard });
  });

  // Handle callback queries (button clicks)
  bot.on('callback_query:data', async (ctx) => {
    const callbackData = ctx.callbackQuery.data;
    const userId = ctx.from?.id;
    
    // Get the user's search results
    const userSearchResults = userId ? userResults.get(userId) : undefined;
    
    // Handle result selection
    if (callbackData.startsWith('result_') && userSearchResults) {
      const index = parseInt(callbackData.split('_')[1]);
      // Show the image when a button is clicked
      if (index >= 0 && index < userSearchResults.length) {
        const selectedResult = userSearchResults[index];
        const textContent = extractTextContent(selectedResult);
        const imageUrl = getImageUrl(selectedResult, c.env.IMAGE_HOST);
        await ctx.replyWithPhoto(imageUrl, {
          caption: textContent
        });
      }
      await ctx.answerCallbackQuery();
    }
    // Handle pagination (would need to store state for this to work properly)
    else if (callbackData === 'prev_page' || callbackData === 'next_page') {
      await ctx.answerCallbackQuery({ text: '分頁功能正在開發中...' });
    }
  });

  // Use the webhookCallback to handle the webhook request
  const handler = webhookCallback(bot, 'hono');
  return await handler(c);
});

// Export the Hono app for Cloudflare Workers
export default app;
