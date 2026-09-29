#!/usr/bin/perl
use strict;
use warnings;
use utf8;

use Cwd qw(abs_path);
use Digest::SHA qw(sha256_hex);
use Encode qw(decode encode);
use File::Basename qw(basename dirname);
use File::Path qw(make_path);
use File::Spec;
use File::Temp qw(tempfile);
use JSON::PP qw(decode_json);

my $START = '<!-- codex-mermaid-loader:start -->';
my $END = '<!-- codex-mermaid-loader:end -->';
my @PACKAGE_FILES = qw(main.js engine.js renderer.js viewer.js manifest.json NOTICE THIRD_PARTY_NOTICES.txt);

sub fail {
    my ($message) = @_;
    die "$message\n";
}

sub absolute_path {
    my ($path) = @_;
    fail 'A path argument is required' if !defined($path) || $path eq '';
    my $absolute = File::Spec->canonpath(File::Spec->rel2abs($path));
    my $resolved = abs_path($absolute);
    return decode_path(defined($resolved) ? $resolved : $absolute);
}

sub decode_path {
    my ($path) = @_;
    return utf8::is_utf8($path) ? $path : decode('UTF-8', $path);
}

sub read_bytes {
    my ($path) = @_;
    open my $fh, '<:raw', $path or fail "Cannot read $path: $!";
    local $/;
    my $data = <$fh>;
    close $fh or fail "Cannot close $path: $!";
    return defined($data) ? $data : '';
}

sub atomic_write {
    my ($path, $data) = @_;
    my $parent = dirname($path);
    make_path($parent) if !-d $parent;
    my $name = basename($path);
    my ($fh, $temp) = tempfile(".$name-XXXXXX", DIR => $parent, UNLINK => 0);
    binmode $fh;
    my $ok = eval {
        print {$fh} $data or die "write failed: $!";
        close $fh or die "close failed: $!";
        if (-e $path) {
            my $mode = (stat($path))[2] & 07777;
            chmod $mode, $temp or die "chmod failed: $!";
        }
        rename $temp, $path or die "rename failed: $!";
        1;
    };
    my $error = $@;
    close $fh if fileno($fh);
    unlink $temp if -e $temp;
    fail "Cannot update $path: $error" if !$ok;
}

sub write_json {
    my ($path, $value) = @_;
    my $json = JSON::PP->new->utf8(1)->canonical(1)->pretty(1)->encode($value) . "\n";
    atomic_write($path, $json);
}

sub read_json {
    my ($path) = @_;
    my $value = eval { decode_json(read_bytes($path)) };
    fail "Invalid installer state $path: $@" if $@;
    fail "Invalid installer state $path" if ref($value) ne 'HASH';
    return $value;
}

sub digest {
    return sha256_hex($_[0]);
}

sub count_token {
    my ($text, $token) = @_;
    my $count = 0;
    my $offset = 0;
    while (1) {
        my $found = index($text, $token, $offset);
        last if $found < 0;
        $count++;
        $offset = $found + length($token);
    }
    return $count;
}

sub strip_block {
    my ($text) = @_;
    my $starts = count_token($text, $START);
    my $ends = count_token($text, $END);
    fail 'Malformed or duplicate installation marker; refusing to edit index.'
        if $starts != $ends || $starts > 1;
    my $start = quotemeta($START);
    my $end = quotemeta($END);
    $text =~ s/\n?$start.*?$end\n?//s;
    return $text;
}

sub html_escape {
    my ($text) = @_;
    $text =~ s/&/&amp;/g;
    $text =~ s/"/&quot;/g;
    $text =~ s/</&lt;/g;
    $text =~ s/>/&gt;/g;
    return $text;
}

sub file_uri {
    my ($path) = @_;
    my $bytes = encode('UTF-8', $path);
    $bytes =~ s/([^A-Za-z0-9\-._~\/:])/sprintf('%%%02X', ord($1))/eg;
    return "file://$bytes";
}

sub empty_directory {
    my ($path) = @_;
    return 0 if !-d $path;
    opendir my $dir, $path or return 0;
    my @entries = grep { $_ ne '.' && $_ ne '..' } readdir $dir;
    closedir $dir;
    return scalar(@entries) == 0;
}

sub paths_for {
    my ($options) = @_;
    my $user_data = absolute_path($options->{user_data});
    return {
        index => absolute_path($options->{app_index}),
        plugin => File::Spec->catdir($user_data, 'codex-mermaid'),
        state_dir => File::Spec->catdir($user_data, '.codex-mermaid-standalone'),
    };
}

sub check_owner {
    my ($state, $paths) = @_;
    fail 'Installer state is missing an appIndex owner.' if !defined($state->{appIndex});
    fail 'Installer state refers to another target.' if $state->{appIndex} ne $paths->{index};
    fail 'Installer state is missing a pluginDir owner.' if !defined($state->{pluginDir});
    fail 'Installer state refers to another target.' if $state->{pluginDir} ne $paths->{plugin};
}

sub package_data {
    my ($source_root) = @_;
    my %data;
    for my $name (@PACKAGE_FILES) {
        my $path = File::Spec->catfile($source_root, 'dist', $name);
        $data{$name} = read_bytes($path);
    }
    return \%data;
}

sub typora_running {
    return JSON::PP::false if $^O ne 'darwin' || !-x '/usr/bin/pgrep';
    open my $process, '-|', '/usr/bin/pgrep', '-x', 'Typora' or return JSON::PP::false;
    local $/;
    <$process>;
    close $process;
    return $? == 0 ? JSON::PP::true : JSON::PP::false;
}

sub restore_install_files {
    my ($plugin, $previous) = @_;
    for my $name (@PACKAGE_FILES) {
        my $path = File::Spec->catfile($plugin, $name);
        if (exists($previous->{$name}) && defined($previous->{$name})) {
            atomic_write($path, $previous->{$name});
        } elsif (-f $path) {
            unlink $path or fail "Cannot roll back $path: $!";
        }
    }
    rmdir $plugin if empty_directory($plugin);
}

sub install {
    my ($options) = @_;
    my $paths = paths_for($options);
    my $data = package_data($options->{source_root});
    my $index_before = read_bytes($paths->{index});
    my $state_path = File::Spec->catfile($paths->{state_dir}, 'state.json');
    my $state;
    $state = read_json($state_path) if -e $state_path;
    check_owner($state, $paths) if $state;

    if (-e $paths->{plugin}) {
        fail 'Existing destination has no installer ownership record.' if !$state;
        fail 'Plugin destination is not a directory.' if !-d $paths->{plugin};
        fail 'Installer state has no file ownership record.' if ref($state->{files}) ne 'HASH';
        for my $name (keys %{$state->{files}}) {
            my $path = File::Spec->catfile($paths->{plugin}, $name);
            fail "Plugin file changed outside installer: $path"
                if !-f($path) || digest(read_bytes($path)) ne $state->{files}{$name};
        }
    }

    fail 'Existing loader block has no active ownership record.'
        if index($index_before, $START) >= 0 && (!$state || $state->{uninstalled});

    my $text = strip_block($index_before);
    fail 'No closing body tag in Typora index.' if $text !~ m{</body\s*>}i;
    $text =~ m{</body\s*>}i;
    my $body_start = $-[0];
    my $new_backup;
    if (!$state || $state->{uninstalled} || digest($index_before) ne ($state->{afterHash} // '')) {
        make_path($paths->{state_dir}) if !-d $paths->{state_dir};
        my $backup = File::Spec->catfile($paths->{state_dir}, 'index-' . time() . '-' . $$ . '.html');
        my $clean = $text;
        atomic_write($backup, $clean);
        $new_backup = $backup;
        $state = {
            schema => 2,
            appIndex => $paths->{index},
            pluginDir => $paths->{plugin},
            backup => $backup,
            beforeHash => digest($clean),
            files => {},
        };
    }

    my $url = html_escape(file_uri(File::Spec->catfile($paths->{plugin}, 'main.js')));
    my $block = "$START\n<script type=\"module\" src=\"$url\"></script>\n$END\n";
    my $after = substr($text, 0, $body_start) . $block . substr($text, $body_start);

    my %previous;
    for my $name (@PACKAGE_FILES) {
        my $path = File::Spec->catfile($paths->{plugin}, $name);
        if (-e $path) {
            fail "Plugin destination contains a non-file: $path" if !-f $path;
            $previous{$name} = read_bytes($path);
        } else {
            $previous{$name} = undef;
        }
    }

    my $ok = eval {
        for my $name (@PACKAGE_FILES) {
            atomic_write(File::Spec->catfile($paths->{plugin}, $name), $data->{$name});
        }
        atomic_write($paths->{index}, $after);
        my %files = map { $_ => digest($data->{$_}) } @PACKAGE_FILES;
        $state->{files} = \%files;
        $state->{afterHash} = digest($after);
        $state->{uninstalled} = JSON::PP::false;
        write_json($state_path, $state);
        1;
    };
    my $error = $@;
    if (!$ok) {
        eval {
            atomic_write($paths->{index}, $index_before)
                if -f($paths->{index}) && digest(read_bytes($paths->{index})) eq digest($after);
        };
        eval { restore_install_files($paths->{plugin}, \%previous); };
        fail $error;
    }
    print JSON::PP->new->utf8(1)->encode({installed => $paths->{plugin}, state => $state_path, restartTypora => JSON::PP::true, typoraRunning => typora_running()}) . "\n";
}

sub uninstall {
    my ($options) = @_;
    my $paths = paths_for($options);
    my $state_path = File::Spec->catfile($paths->{state_dir}, 'state.json');
    fail "Installer state not found: $state_path" if !-e $state_path;
    my $state = read_json($state_path);
    check_owner($state, $paths);
    if ($state->{uninstalled}) {
        print "Already uninstalled.\n";
        return;
    }

    my $current = read_bytes($paths->{index});
    fail 'Installer state has no backup path.' if !defined($state->{backup});
    my $backup = read_bytes($state->{backup});
    fail 'Backup integrity check failed.' if digest($backup) ne ($state->{beforeHash} // '');
    my $restored = digest($current) eq ($state->{afterHash} // '') ? $backup : strip_block($current);

    my %removed;
    my @retained;
    my $ok = eval {
        atomic_write($paths->{index}, $restored);
        fail 'Installer state has no file ownership record.' if ref($state->{files}) ne 'HASH';
        for my $name (keys %{$state->{files}}) {
            my $path = File::Spec->catfile($paths->{plugin}, $name);
            next if !-e $path;
            if (-f($path) && digest(read_bytes($path)) eq $state->{files}{$name}) {
                $removed{$name} = read_bytes($path);
                unlink $path or fail "Cannot remove $path: $!";
            } else {
                push @retained, $path;
            }
        }
        rmdir $paths->{plugin} if empty_directory($paths->{plugin});
        $state->{uninstalled} = JSON::PP::true;
        write_json($state_path, $state);
        1;
    };
    my $error = $@;
    if (!$ok) {
        eval {
            atomic_write($paths->{index}, $current)
                if -f($paths->{index}) && digest(read_bytes($paths->{index})) eq digest($restored);
        };
        eval {
            for my $name (keys %removed) {
                atomic_write(File::Spec->catfile($paths->{plugin}, $name), $removed{$name});
            }
        };
        fail $error;
    }
    print JSON::PP->new->utf8(1)->encode({uninstalled => JSON::PP::true, retainedModifiedFiles => \@retained, restartTypora => JSON::PP::true, typoraRunning => typora_running()}) . "\n";
}

sub parse_options {
    my ($command, @args) = @_;
    my $script = absolute_path(__FILE__);
    my $source_root = dirname(dirname($script));
    my %options = (
        source_root => $source_root,
        app_index => '/Applications/Typora.app/Contents/Resources/TypeMark/index.html',
        user_data => (decode_path($ENV{HOME} // '') . '/Library/Application Support/abnerworks.Typora'),
    );
    while (@args) {
        my $arg = shift @args;
        my ($key, $value);
        if ($arg =~ /^(--source-root|--app-index|--user-data)=(.*)$/s) {
            ($key, $value) = ($1, $2);
        } elsif ($arg =~ /^(--source-root|--app-index|--user-data)$/) {
            fail "$arg requires a value" if !@args;
            ($key, $value) = ($arg, shift @args);
        } elsif ($arg eq '--help' || $arg eq '-h') {
            print_usage();
            exit 0;
        } else {
            fail "Unknown option: $arg";
        }
        $value = decode_path($value);
        $options{source_root} = $value if $key eq '--source-root';
        $options{app_index} = $value if $key eq '--app-index';
        $options{user_data} = $value if $key eq '--user-data';
    }
    $options{source_root} = absolute_path($options{source_root});
    return \%options;
}

sub print_usage {
    print <<'USAGE';
Usage: /usr/bin/perl scripts/manage.pl install|uninstall [options]

Options:
  --source-root PATH  Package root containing dist/ (default: repository root)
  --app-index PATH    Typora TypeMark/index.html path
  --user-data PATH    Typora user data directory
USAGE
}

sub main {
    my $command = shift @ARGV // '';
    if ($command eq '--help' || $command eq '-h' || $command eq '') {
        print_usage();
        exit($command eq '' ? 2 : 0);
    }
    fail "Unknown command: $command" if $command ne 'install' && $command ne 'uninstall';
    my $options = parse_options($command, @ARGV);
    $command eq 'install' ? install($options) : uninstall($options);
}

eval { main(); 1 } or do {
    my $error = $@ || 'Unknown installer error';
    $error =~ s/\s+$//;
    print STDERR ucfirst($error) . "\n";
    exit 1;
};
