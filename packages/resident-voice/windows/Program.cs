using System.Text.Json;
using System.Windows.Forms;
using Windows.Globalization;
using Windows.Media.Core;
using Windows.Media.Devices;
using Windows.Media.Playback;
using Windows.Media.SpeechRecognition;
using Windows.Media.SpeechSynthesis;

namespace Jarvis.Voice.Windows;

internal static class Program
{
    [STAThread]
    private static async Task<int> Main(string[] args)
    {
        Console.InputEncoding = System.Text.Encoding.UTF8;
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        if (args.Contains("--probe", StringComparer.Ordinal))
        {
            return await ProbeAsync();
        }

        try
        {
            ApplicationConfiguration.Initialize();
            using var context = new ResidentVoiceContext();
            context.StartCommandReader();
            Application.Run(context);
            return 0;
        }
        catch (Exception error)
        {
            EmitError("helper_initialization", "VOICE_HELPER_INITIALIZATION_FAILED", error);
            return 1;
        }
    }

    private static async Task<int> ProbeAsync()
    {
        try
        {
            var languages = SpeechRecognizer.SupportedGrammarLanguages
                .Select(language => language.LanguageTag)
                .ToArray();
            using var recognizer = new SpeechRecognizer(new Language("pt-BR"));
            recognizer.Constraints.Add(new SpeechRecognitionTopicConstraint(
                SpeechRecognitionScenario.Dictation,
                "Jarvis voice commands"));
            var compilation = await recognizer.CompileConstraintsAsync();
            using var synthesizer = new SpeechSynthesizer();
            var defaultCaptureDeviceId = MediaDevice.GetDefaultAudioCaptureId(AudioDeviceRole.Default);
            var voices = SpeechSynthesizer.AllVoices
                .Where(voice => voice.Language.StartsWith("pt-BR", StringComparison.OrdinalIgnoreCase))
                .Select(voice => new { name = voice.DisplayName, gender = voice.Gender.ToString(), language = voice.Language })
                .ToArray();
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                ok = compilation.Status == SpeechRecognitionResultStatus.Success,
                languages,
                hasDefaultCaptureDevice = !string.IsNullOrWhiteSpace(defaultCaptureDeviceId),
                constraintStatus = compilation.Status.ToString(),
                voices,
            }));
            return compilation.Status == SpeechRecognitionResultStatus.Success ? 0 : 1;
        }
        catch (Exception error)
        {
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                ok = false,
                code = "WINRT_SPEECH_UNAVAILABLE",
                exceptionType = error.GetType().FullName,
                hresult = $"0x{error.HResult:X8}",
            }));
            return 1;
        }
    }

    internal static void EmitError(string stage, string code, Exception error)
    {
        var value = new Dictionary<string, object?>
        {
            ["type"] = "error",
            ["data"] = new
            {
                code,
                stage,
                exceptionType = error.GetType().FullName,
                hresult = $"0x{error.HResult:X8}",
            },
        };
        Console.Out.WriteLine(JsonSerializer.Serialize(value));
        Console.Out.Flush();
    }
}

internal sealed class ResidentVoiceContext : ApplicationContext
{
    private readonly Form messageWindow;
    private readonly NotifyIcon trayIcon;
    private readonly SpeechSynthesizer synthesizer;
    private readonly MediaPlayer player;
    private SpeechRecognizer? recognizer;
    private bool listening;
    private bool speaking;
    private bool stopping;
    private bool constraintsCompiled;
    private CancellationTokenSource? speechCancellation;
    private float speakingRate = 1f;
    private float volume = 1f;

    public ResidentVoiceContext()
    {
        messageWindow = new Form
        {
            ShowInTaskbar = false,
            FormBorderStyle = FormBorderStyle.FixedToolWindow,
            WindowState = FormWindowState.Minimized,
            Opacity = 0,
            Width = 1,
            Height = 1,
            Text = "Jarvis Voice",
        };
        messageWindow.Shown += async (_, _) =>
        {
            messageWindow.Hide();
            await StartListeningAsync();
        };
        trayIcon = new NotifyIcon
        {
            Icon = System.Drawing.SystemIcons.Application,
            Text = "Jarvis residente: inicializando",
            Visible = true,
            ContextMenuStrip = CreateMenu(),
        };
        synthesizer = new SpeechSynthesizer();
        var portugueseVoices = SpeechSynthesizer.AllVoices
            .Where(voice => voice.Language.StartsWith("pt-BR", StringComparison.OrdinalIgnoreCase))
            .ToArray();
        var selectedVoice = portugueseVoices.FirstOrDefault(voice => voice.Gender == VoiceGender.Male)
            ?? portugueseVoices.FirstOrDefault();
        if (selectedVoice is not null)
        {
            synthesizer.Voice = selectedVoice;
        }

        player = new MediaPlayer();
        player.MediaEnded += (_, _) => SetTrayState("Aguardando Jarvis");
        player.MediaFailed += (_, _) => Emit("error", new { code = "SPEECH_OUTPUT_FAILED", stage = "speech_playback" });
        messageWindow.Show();
        MainForm = messageWindow;
    }

    public void StartCommandReader()
    {
        _ = Task.Run(async () =>
        {
            while (!stopping)
            {
                string? line;
                try
                {
                    line = await Console.In.ReadLineAsync();
                }
                catch
                {
                    break;
                }

                if (line is null)
                {
                    if (!stopping) messageWindow.BeginInvoke(async () => { await StopAsync(); ExitThread(); });
                    break;
                }

                try
                {
                    using var document = JsonDocument.Parse(line);
                    var command = document.RootElement.Clone();
                    if (!command.TryGetProperty("type", out var typeElement) || typeElement.ValueKind != JsonValueKind.String)
                    {
                        continue;
                    }

                    var type = typeElement.GetString();
                    messageWindow.BeginInvoke(async () =>
                    {
                        try { if (!stopping) await HandleCommandAsync(type, command); }
                        catch (Exception error) { Program.EmitError("service_runtime", "VOICE_COMMAND_FAILED", error); }
                    });
                }
                catch (JsonException)
                {
                    Emit("error", new { code = "INVALID_BRIDGE_MESSAGE" });
                }
                catch (InvalidOperationException)
                {
                    break;
                }
            }
        });
    }

    private ContextMenuStrip CreateMenu()
    {
        var menu = new ContextMenuStrip();
        var status = new ToolStripMenuItem("Jarvis residente") { Enabled = false };
        var stop = new ToolStripMenuItem("Desativar escuta");
        stop.Click += (_, _) => Emit("disable");
        var exit = new ToolStripMenuItem("Encerrar processo residente");
        exit.Click += (_, _) => Emit("disable");
        menu.Items.Add(status);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(stop);
        menu.Items.Add(exit);
        menu.Opening += (_, _) => status.Text = listening ? "Microfone ativo · aguardando Jarvis" : "Microfone inativo";
        return menu;
    }

    private async Task StartListeningAsync()
    {
        if (stopping || listening || speaking)
        {
            return;
        }

        var stage = "recognizer_language";
        try
        {
            if (!SpeechRecognizer.SupportedGrammarLanguages.Any(language =>
                    language.LanguageTag.Equals("pt-BR", StringComparison.OrdinalIgnoreCase)))
            {
                Emit("error", new { code = "PT_BR_RECOGNIZER_UNAVAILABLE", stage });
                return;
            }

            stage = "recognizer_create";
            recognizer ??= CreateRecognizer();
            if (!constraintsCompiled)
            {
                stage = "grammar_compile";
                var result = await recognizer.CompileConstraintsAsync();
                if (result.Status != SpeechRecognitionResultStatus.Success)
                {
                    Emit("error", new { code = "RECOGNITION_GRAMMAR_FAILED", stage, constraintStatus = result.Status.ToString() });
                    return;
                }
                constraintsCompiled = true;
            }

            stage = "microphone_start";
            await recognizer.ContinuousRecognitionSession.StartAsync();
            listening = true;
            SetTrayState("Microfone ativo · aguardando Jarvis");
            Emit("state", new { state = "awaiting_activation", microphoneActive = true });
        }
        catch (UnauthorizedAccessException error)
        {
            Program.EmitError(stage, "MICROPHONE_PERMISSION_DENIED", error);
            SetTrayState("Acesso ao microfone negado");
        }
        catch (Exception error) when (error.HResult == unchecked((int)0x80070005))
        {
            Program.EmitError(stage, "MICROPHONE_PERMISSION_DENIED", error);
            SetTrayState("Acesso ao microfone negado");
        }
        catch (Exception error)
        {
            Program.EmitError(stage, "MICROPHONE_UNAVAILABLE", error);
            SetTrayState("Microfone indisponível");
        }
    }

    private SpeechRecognizer CreateRecognizer()
    {
        var instance = new SpeechRecognizer(new Language("pt-BR"));
        instance.Constraints.Add(new SpeechRecognitionTopicConstraint(
            SpeechRecognitionScenario.Dictation,
            "Jarvis voice commands"));
        instance.ContinuousRecognitionSession.ResultGenerated += (_, args) =>
        {
            if (args.Result.Status == SpeechRecognitionResultStatus.Success &&
                args.Result.Confidence != SpeechRecognitionConfidence.Rejected &&
                args.Result.Confidence != SpeechRecognitionConfidence.Low &&
                !string.IsNullOrWhiteSpace(args.Result.Text))
            {
                Emit("transcript", new { text = args.Result.Text, confidence = args.Result.Confidence.ToString() });
            }
        };
        instance.ContinuousRecognitionSession.Completed += (_, args) =>
        {
            listening = false;
            if (!stopping && !speaking && args.Status != SpeechRecognitionResultStatus.UserCanceled)
            {
                Emit("recognition_ended", new { status = args.Status.ToString() });
            }
        };
        return instance;
    }

    private async Task HandleCommandAsync(string? type, JsonElement command)
    {
        switch (type)
        {
            case "pause":
                await PauseAsync();
                break;
            case "resume":
                await StartListeningAsync();
                break;
            case "speak":
                if (!command.TryGetProperty("text", out var text) || text.ValueKind != JsonValueKind.String ||
                    string.IsNullOrWhiteSpace(text.GetString()) || text.GetString()!.Length > 2500)
                {
                    Emit("error", new { code = "INVALID_SPEECH_TEXT" });
                    return;
                }

                speakingRate = ReadBoundedNumber(command, "rate", 0.75f, 1.25f, speakingRate);
                volume = ReadBoundedNumber(command, "volume", 0f, 1f, volume);
                await SpeakAsync(text.GetString()!);
                break;
            case "shutdown":
                await StopAsync();
                ExitThread();
                break;
            case "disable":
                Emit("disable");
                break;
        }
    }

    private static float ReadBoundedNumber(JsonElement value, string property, float min, float max, float fallback)
    {
        return value.TryGetProperty(property, out var number) && number.TryGetSingle(out var parsed) &&
            parsed >= min && parsed <= max ? parsed : fallback;
    }

    private async Task PauseAsync()
    {
        if (!listening || recognizer is null)
        {
            return;
        }

        listening = false;
        await recognizer.ContinuousRecognitionSession.StopAsync();
        Emit("state", new { state = "processing", microphoneActive = false });
        SetTrayState("Processando comando");
    }

    private async Task SpeakAsync(string text)
    {
        using var cancellation = new CancellationTokenSource();
        speechCancellation = cancellation;
        speaking = true;
        SetTrayState("Respondendo por voz");
        Emit("state", new { state = "speaking", microphoneActive = false });
        await PauseAsync();
        try
        {
            synthesizer.Options.AudioPitch = 0.9;
            synthesizer.Options.SpeakingRate = speakingRate;
            synthesizer.Options.AudioVolume = volume;
            using var stream = await synthesizer.SynthesizeTextToStreamAsync(text);
            var ended = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            void OnEnded(MediaPlayer sender, object args) => ended.TrySetResult();
            void OnFailed(MediaPlayer sender, MediaPlayerFailedEventArgs args) =>
                ended.TrySetException(args.ExtendedErrorCode ?? new InvalidOperationException("Windows speech playback failed."));
            player.MediaEnded += OnEnded;
            player.MediaFailed += OnFailed;
            try
            {
                player.Volume = volume;
                player.Source = MediaSource.CreateFromStream(stream, stream.ContentType);
                player.Play();
                await ended.Task.WaitAsync(TimeSpan.FromMinutes(2), cancellation.Token);
            }
            finally
            {
                player.MediaEnded -= OnEnded;
                player.MediaFailed -= OnFailed;
                if (!stopping) { player.Pause(); player.Source = null; }
            }
        }
        catch (OperationCanceledException) when (stopping) { }
        catch (Exception error)
        {
            Program.EmitError("speech_playback", "SPEECH_OUTPUT_FAILED", error);
        }
        finally
        {
            speechCancellation = null;
            speaking = false;
            if (!stopping)
            {
            Emit("speech_complete");
            Emit("state", new { state = "awaiting_activation", microphoneActive = false });
            await StartListeningAsync();
            }
        }
    }

    private async Task StopAsync()
    {
        if (stopping) return;
        stopping = true;
        speechCancellation?.Cancel();
        await PauseAsync();
        player.Pause();
        trayIcon.Visible = false;
        trayIcon.Dispose();
        synthesizer.Dispose();
        player.Dispose();
        recognizer?.Dispose();
        messageWindow.Dispose();
    }

    private void SetTrayState(string state)
    {
        trayIcon.Text = state.Length > 63 ? state[..63] : state;
    }

    private static void Emit(string type, object? data = null)
    {
        var value = new Dictionary<string, object?> { ["type"] = type };
        if (data is not null) value["data"] = data;
        Console.Out.WriteLine(JsonSerializer.Serialize(value));
        Console.Out.Flush();
    }

}
