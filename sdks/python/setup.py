from setuptools import setup, find_packages

setup(
    name="proxyhubb",
    version="0.1.0",
    description="Official Python SDK for the AI-Native ProxyHubb Network",
    author="ProxyHubb Founders",
    packages=find_packages(),
    install_requires=[
        "requests>=2.31.0",
        "urllib3>=2.0.0",
    ],
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    python_requires='>=3.8',
)
