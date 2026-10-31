console.error('此入口已停用。请用 node hyread/cli.mjs prepare --volume <卷号> --asset-id <id> --title <书名> 准备资源；浏览器正文用 receive / finalize 分块接收，不直接写入资源目录。');
process.exitCode = 1;
