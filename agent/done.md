### provider, use Adapter Pattern to <span style="color:#d73a49">normalize</span> vendor-specific APIs <span style="color:#d73a49">to</span> AiProvider

  #### The provider layer normalizes vendor-specific model APIs to one internal AiProvider interface.

  #### Explanation:
  <span style="color:#d73a49">Normalize</span> OpenAI SDK calls <span style="color:#d73a49">to</span>
  AiProvider.chat.
  <span style="color:#d73a49">to</span> AgentEvent.
  <span style="color:#d73a49">to</span> the same OpenAI adapter.

  ### provider factory, use Factory Pattern to <span style="color:#d73a49">map</span> provider name <span style="color:#d73a49">to</span> provider instance

  #### The provider factory maps a provider name to the correct provider instance.

  #### Explanation:
  <span style="color:#d73a49">Map</span> openai <span style="color:#d73a49">to</span> OpenAIAdaptor.
  <span style="color:#d73a49">Map</span> deepseek <span style="color:#d73a49">to</span> OpenAIAdaptor.
  <span style="color:#d73a49">Map</span> config input <span style="color:#d73a49">to</span> a ready-to-use client.

  ### tool registry, use Registry Pattern to <span style="color:#d73a49">map</span> tool name <span style="color:#d73a49">to</span> tool command

  #### The tool registry maps a model-requested tool name to an executable tool command.

  #### Explanation:
  <span style="color:#d73a49">Register</span> read_file <span style="color:#d73a49">as</span> a tool command.
  <span style="color:#d73a49">Register</span> list_files <span style="color:#d73a49">as</span> a tool command.
  <span style="color:#d73a49">Look up</span> tool name <span style="color:#d73a49">to</span> execute the matching
  command.

  ### tool, use Command Pattern to <span style="color:#d73a49">wrap</span> local capability <span style="color:#d73a49">as</span> executable command

  #### A tool wraps a local capability as a model-callable executable command.

  #### Explanation:
  <span style="color:#d73a49">Wrap</span> file reading <span style="color:#d73a49">as</span> read_file.
  <span style="color:#d73a49">Wrap</span> directory listing <span style="color:#d73a49">as</span> list_files.
  <span style="color:#d73a49">Wrap</span> tool logic <span style="color:#d73a49">behind</span> execute(args, context).

  ### tool context, use Context Object Pattern to <span style="color:#d73a49">pass</span> runtime state <span  style="color:#d73a49">to</span> tool execution

  #### Tool context passes runtime state to tool execution without relying on globals.

  #### Explanation:
  <span style="color:#d73a49">Pass</span> cwd <span style="color:#d73a49">to</span> file tools.
  <span style="color:#d73a49">Resolve</span> relative paths <span <span style="color:#d73a49">against</span> context.cwd.
  <span style="color:#d73a49">Avoid</span> hardcoded project paths <span <span style="color:#d73a49">inside</span> tools.

  ### message, use DTO to <span style="color:#d73a49">represent</span> model context <span style="color:#d73a49">as</span> typed records

  #### Messages represent model context as typed records exchanged with the provider.

  #### Explanation:
  <span style="color:#d73a49">Represent</span> user input <span style="color:#d73a49">as</span> UserMessage.
<span  style="color:#d73a49">Represent</span> model output <span style="color:#d73a49">as</span> AssistantMessage.
  <span style="color:#d73a49">Represent</span> tool output <span style="color:#d73a49">as</span> ToolMessage.

  ### agent event, use Event Object to <span style="color:#d73a49">represent</span> runtime progress <span style="color:#d73a49">as</span> typed events

  #### Agent events represent runtime progress as typed events emitted during execution.

  #### Explanation:
  <span style="color:#d73a49">Represent</span> streaming text <span style="color:#d73a49">as</span> text_delta.
  text_delta.<span style="color:#d73a49">Represent</span> tool requests <span style="color:#d73a49">as</span>
  tool_call.
  tool_result.

  ### OpenAI adapter, use Anti-Corruption Layer to <span style="color:#d73a49">translate</span> OpenAI schema <span style="color:#d73a49">to</span> runtime schema

  #### The OpenAI adapter translates OpenAI-specific schema to internal runtime schema.

  #### Explanation:
  <span style="color:#d73a49">Translate</span> tool_calls <span style="color:#d73a49">to</span> toolCalls.
  <span style="color:#d73a49">Translate</span> tool_call_id <span style="color:#d73a49">to</span> toolCallId.
  <span style="color:#d73a49">Translate</span> SDK response shape <span style="color:#d73a49">to</span> AssistantMessage.